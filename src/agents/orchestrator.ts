import { logger } from '../core/logger.js';
import type { AgentDefinition } from './registry/types.js'
import type { Message, Provider, ToolCall } from '../types/index.js'
import { getAgentRegistry } from './registry/loader.js'
import { runAgent, AgentConfig, BUILTIN_TOOLS, streamProvider } from '../providers/client.js'
import { ToolExecutor } from '../tools/executor.js'

export interface AgentOrchestrationConfig {
  mode: 'full' | 'sprint' | 'micro'
  primaryAgent: string
  supportingAgents?: string[]
  maxRetries?: number
  qualityGates?: boolean
}

export interface AgentTaskResult {
  agentId: string
  agentName: string
  success: boolean
  output: string
  errors?: string[]
  durationMs: number
  tokensUsed?: number
}

export interface OrchestrationState {
  phase: string
  currentAgent: string | null
  completedTasks: AgentTaskResult[]
  failedTasks: AgentTaskResult[]
  startTime: number
  qualityGatePassed: boolean
}

export type AgentProgressCallback = (state: OrchestrationState) => void

export class AgentOrchestrator {
  private registry = getAgentRegistry()
  private state: OrchestrationState | null = null
  private onProgress?: AgentProgressCallback

  setProgressCallback(cb: AgentProgressCallback) {
    this.onProgress = cb
  }

  private emitProgress() {
    if (this.state && this.onProgress) {
      this.onProgress({ ...this.state })
    }
  }

  async activateAgent(
    agentId: string,
    context: string,
    provider: Provider,
    apiKeys: Partial<Record<Provider, string>>,
    model: string,
    workingDir: string,
    maxSteps: number,
    systemPromptBase: string,
  ): Promise<AgentTaskResult> {
    const agent = this.registry.getAgent(agentId)
    if (!agent) {
      return {
        agentId,
        agentName: agentId,
        success: false,
        output: `Agent "${agentId}" not found`,
        errors: ['Agent not found in registry'],
        durationMs: 0,
      }
    }

    const startTime = Date.now()
    const agentSystemPrompt = `You are ${agent.name}. ${agent.vibe ? `Vibe: ${agent.vibe}.` : ''}\n\n${agent.prompt}\n\n---\n\nBase system instructions:\n${systemPromptBase}\n\nTask context: ${context}`

    let output = ''
    let errors: string[] = []

    const executor = new ToolExecutor(workingDir)

    const agentCfg: AgentConfig = {
      maxSteps,
      tools: BUILTIN_TOOLS,
      onToolCall: async () => ({ allowed: true, allowAll: false }),
      onToolResult: (_tc: ToolCall, result: string) => {
        output += `[tool:${_tc.name}] ${result.slice(0, 500)}\n`
      },
      executeTool: async (toolCall: ToolCall) => executor.execute(toolCall),
    }

    try {
      await runAgent(
        provider,
        apiKeys,
        model,
        [{ role: 'user', content: context }],
        (chunk) => {
          if (chunk.text) output += chunk.text
        },
        agentCfg,
        agentSystemPrompt,
      )
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err))
    }

    return {
      agentId,
      agentName: agent.name,
      success: errors.length === 0 && output.length > 0,
      output: output.trim() || 'Agent completed with no output.',
      errors: errors.length > 0 ? errors : undefined,
      durationMs: Date.now() - startTime,
    }
  }

  async runOrchestration(
    config: AgentOrchestrationConfig,
    task: string,
    provider: Provider,
    apiKeys: Partial<Record<Provider, string>>,
    model: string,
    workingDir: string,
    systemPromptBase: string,
    maxSteps: number = 20,
  ): Promise<OrchestrationState> {
    this.state = {
      phase: 'initializing',
      currentAgent: config.primaryAgent,
      completedTasks: [],
      failedTasks: [],
      startTime: Date.now(),
      qualityGatePassed: false,
    }
    this.emitProgress()

    // Phase 1: Decompose task
    this.state.phase = 'decomposing'
    this.emitProgress()

    let subtasks: string[] = [task]
    if (config.mode !== 'micro') {
      const decomposePrompt = `Decompose the following task into independent subtasks that can be worked on sequentially or in parallel.\nReply with ONLY a JSON array of strings.\n\nTask: ${task}`
      let raw = ''
      try {
        await streamProvider(
          provider, apiKeys, model,
          [{ role: 'user', content: decomposePrompt }],
          (chunk) => { if (chunk.text) raw += chunk.text },
          systemPromptBase,
        )
        const match = raw.match(/\[[\s\S]*\]/)
        if (match) {
          const parsed = JSON.parse(match[0]) as string[]
          if (parsed.length >= 2) subtasks = parsed
        }
      } catch (err) { logger.warn('Task decomposition failed', { error: err instanceof Error ? err.message : String(err) }); }
    }

    // Phase 2: Run primary agent on first subtask
    this.state.phase = 'primary-execution'
    this.emitProgress()

    const primaryResult = await this.activateAgent(
      config.primaryAgent,
      `Task: ${subtasks[0]}\nMode: ${config.mode}\nTotal subtasks: ${subtasks.length}`,
      provider, apiKeys, model, workingDir, maxSteps, systemPromptBase,
    )

    if (primaryResult.success) {
      this.state.completedTasks.push(primaryResult)
    } else {
      this.state.failedTasks.push(primaryResult)
    }
    this.emitProgress()

    // Phase 3: Run supporting agents on remaining subtasks (parallel if mode !== 'micro')
    if (subtasks.length > 1 && config.supportingAgents?.length) {
      this.state.phase = 'parallel-execution'
      this.emitProgress()

      const remainingTasks = subtasks.slice(1)
      const agentAssignments: Array<{ agentId: string; subtask: string }> = []

      for (let i = 0; i < remainingTasks.length; i++) {
        const agentId = config.supportingAgents[i % config.supportingAgents.length]
        agentAssignments.push({ agentId, subtask: remainingTasks[i] })
      }

      if (config.mode === 'full' || config.mode === 'sprint') {
        // Run in parallel batches
        const batchSize = config.mode === 'full' ? 3 : 1
        for (let batchStart = 0; batchStart < agentAssignments.length; batchStart += batchSize) {
          const batch = agentAssignments.slice(batchStart, batchStart + batchSize)
          this.state.currentAgent = batch[0].agentId
          this.state.phase = `batch-${Math.floor(batchStart / batchSize) + 1}`
          this.emitProgress()

          const results = await Promise.all(
            batch.map(async ({ agentId, subtask }) => {
              const retries = config.maxRetries ?? 3
              for (let attempt = 1; attempt <= retries; attempt++) {
                const result = await this.activateAgent(
                  agentId,
                  `Subtask ${batchStart + attempt}/${subtasks.length}: ${subtask}`,
                  provider, apiKeys, model, workingDir, maxSteps, systemPromptBase,
                )
                if (result.success || attempt === retries) return result
              }
              return this.activateAgent(agentId, subtask, provider, apiKeys, model, workingDir, maxSteps, systemPromptBase)
            }),
          )

          for (const result of results) {
            if (result.success) {
              this.state.completedTasks.push(result)
            } else {
              this.state.failedTasks.push(result)
            }
          }
          this.emitProgress()
        }
      } else {
        // Micro mode: sequential
        for (const { agentId, subtask } of agentAssignments) {
          this.state.currentAgent = agentId
          this.state.phase = `sequential-${agentId}`
          this.emitProgress()

          const result = await this.activateAgent(
            agentId,
            `Subtask: ${subtask}`,
            provider, apiKeys, model, workingDir, maxSteps, systemPromptBase,
          )

          if (result.success) {
            this.state.completedTasks.push(result)
          } else {
            this.state.failedTasks.push(result)
          }
          this.emitProgress()
        }
      }
    }

    // Phase 4: Quality gate
    if (config.qualityGates && this.state.failedTasks.length > 0) {
      this.state.phase = 'quality-gate'
      this.emitProgress()

      // Retry failed tasks once with the primary agent
      const retryResults = await Promise.all(
        this.state.failedTasks.map(async (failed) => {
          return this.activateAgent(
            config.primaryAgent,
            `Retry failed task. Previous output: ${failed.output}\nFix the issues and complete the task.`,
            provider, apiKeys, model, workingDir, maxSteps, systemPromptBase,
          )
        }),
      )

      this.state.failedTasks = []
      for (const result of retryResults) {
        if (result.success) {
          this.state.completedTasks.push(result)
        } else {
          this.state.failedTasks.push(result)
        }
      }
      this.emitProgress()
    }

    // Phase 5: Synthesis
    this.state.phase = 'synthesis'
    this.emitProgress()

    if (this.state.completedTasks.length > 1) {
      const synthesisPrompt = `Synthesize the following agent outputs into a coherent summary and final result.\n\n${this.state.completedTasks.map(t => `## ${t.agentName}\n${t.output.slice(0, 1000)}`).join('\n\n---\n\n')}`

      let synthesis = ''
      try {
        await streamProvider(
          provider, apiKeys, model,
          [{ role: 'user', content: synthesisPrompt }],
          (chunk) => { if (chunk.text) synthesis += chunk.text },
          systemPromptBase,
        )
      } catch (err) { logger.warn('Synthesis failed', { error: err instanceof Error ? err.message : String(err) }); }

      if (synthesis) {
        this.state.completedTasks.push({
          agentId: 'synthesis',
          agentName: 'Synthesis',
          success: true,
          output: synthesis.trim(),
          durationMs: 0,
        })
      }
    }

    this.state.phase = 'complete'
    this.state.qualityGatePassed = this.state.failedTasks.length === 0
    this.state.currentAgent = null
    this.emitProgress()

    return this.state
  }

  getStatus(): OrchestrationState | null {
    return this.state
  }

  getAvailableAgents(): AgentDefinition[] {
    return this.registry.allAgents
  }

  getCategories() {
    return this.registry.categories
  }

  searchAgents(query: string): AgentDefinition[] {
    return this.registry.searchAgents(query)
  }

  getAgent(id: string): AgentDefinition | undefined {
    return this.registry.getAgent(id)
  }
}

let orchestrator: AgentOrchestrator | null = null

export function getOrchestrator(): AgentOrchestrator {
  if (!orchestrator) {
    orchestrator = new AgentOrchestrator()
  }
  return orchestrator
}
