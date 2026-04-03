// src/agents/autoDispatch.ts

import type { AgentDefinition } from './registry/types.js';
import type { Message, Provider } from '../types/index.js';
import type { Settings } from '../settings/types.js';
import { getAgentRegistry } from './registry/loader.js';
import { getOrchestrator } from './orchestrator.js';
import { streamProvider } from '../providers/client.js';

interface DispatchDecision {
  shouldDispatch: boolean;
  selectedAgents: Array<{ agent: AgentDefinition; reason: string; priority: number }>;
  estimatedCost: number;
}

const KEYWORD_AGENT_MAP: Record<string, string[]> = {
  'security': ['security-engineer', 'threat-detection', 'compliance-auditor'],
  'vulnerability': ['security-engineer', 'threat-detection'],
  'exploit': ['security-engineer', 'threat-detection'],
  'authentication': ['security-engineer', 'backend-architect'],
  'database': ['database-optimizer', 'data-engineer', 'backend-architect'],
  'sql': ['database-optimizer', 'data-engineer'],
  'query': ['database-optimizer', 'data-engineer'],
  'performance': ['performance-benchmarker', 'database-optimizer', 'sre'],
  'slow': ['performance-benchmarker', 'database-optimizer'],
  'optimize': ['performance-benchmarker', 'database-optimizer', 'workflow-optimizer'],
  'test': ['api-tester', 'test-results-analyzer', 'testing-reality-checker'],
  'bug': ['code-reviewer', 'testing-reality-checker', 'reality-checker'],
  'fix': ['senior-developer', 'frontend-developer', 'backend-architect'],
  'refactor': ['senior-developer', 'software-architect', 'code-reviewer'],
  'api': ['api-tester', 'backend-architect', 'mobile-app-builder'],
  'endpoint': ['api-tester', 'backend-architect'],
  'frontend': ['frontend-developer', 'ui-designer', 'ux-architect'],
  'ui': ['ui-designer', 'frontend-developer', 'ux-architect'],
  'css': ['ui-designer', 'frontend-developer'],
  'design': ['ui-designer', 'ux-architect', 'brand-guardian'],
  'ux': ['ux-researcher', 'ux-architect'],
  'mobile': ['mobile-app-builder'],
  'ios': ['mobile-app-builder'],
  'android': ['mobile-app-builder'],
  'deploy': ['devops-automator', 'sre', 'infrastructure-maintainer'],
  'ci': ['devops-automator'],
  'cd': ['devops-automator'],
  'docker': ['devops-automator', 'infrastructure-maintainer'],
  'kubernetes': ['devops-automator', 'sre'],
  'infrastructure': ['devops-automator', 'sre', 'infrastructure-maintainer'],
  'ml': ['ai-engineer'],
  'machine learning': ['ai-engineer'],
  'model': ['ai-engineer'],
  'training': ['ai-engineer'],
  'data': ['data-engineer', 'ai-engineer', 'data-consolidation-agent'],
  'pipeline': ['data-engineer', 'devops-automator'],
  'documentation': ['technical-writer', 'document-generator'],
  'docs': ['technical-writer', 'document-generator'],
  'readme': ['technical-writer'],
  'git': ['git-workflow-master', 'senior-developer'],
  'commit': ['git-workflow-master'],
  'branch': ['git-workflow-master'],
  'marketing': ['growth-hacker', 'content-creator', 'social-media-strategist'],
  'seo': ['seo-specialist'],
  'content': ['content-creator'],
  'social': ['social-media-strategist', 'twitter-engager'],
  'product': ['product-trend-researcher', 'sprint-prioritizer', 'feedback-synthesizer'],
  'project': ['project-manager-senior', 'project-shepherd'],
  'incident': ['incident-response-commander', 'sre', 'threat-detection'],
  'monitoring': ['sre', 'infrastructure-maintainer', 'analytics-reporter'],
  'analytics': ['analytics-reporter', 'data-analytics-reporter'],
  'report': ['analytics-reporter', 'executive-summary-generator'],
  'review': ['code-reviewer', 'testing-reality-checker'],
  'architecture': ['software-architect', 'backend-architect'],
  'system design': ['software-architect'],
  'microservice': ['software-architect', 'backend-architect'],
  'blockchain': ['blockchain-security-auditor', 'solidity-smart-contract-engineer'],
  'smart contract': ['solidity-smart-contract-engineer', 'blockchain-security-auditor'],
  'lsp': ['lsp-index-engineer'],
  'language server': ['lsp-index-engineer'],
};

export function analyzeTaskForAgents(message: string, availableAgents: AgentDefinition[]): DispatchDecision {
  const lower = message.toLowerCase();
  const selected: Array<{ agent: AgentDefinition; reason: string; priority: number }> = [];
  const matchedKeywords = new Set<string>();

  for (const [keyword, agentIds] of Object.entries(KEYWORD_AGENT_MAP)) {
    if (lower.includes(keyword)) {
      matchedKeywords.add(keyword);
      for (const agentId of agentIds) {
        const agent = availableAgents.find(a => a.id.includes(agentId) || agentId.includes(a.id));
        if (agent && !selected.find(s => s.agent.id === agent.id)) {
          selected.push({ agent, reason: `Keyword match: "${keyword}"`, priority: keyword.length });
        }
      }
    }
  }

  // Also match against agent descriptions
  for (const agent of availableAgents) {
    const desc = agent.description.toLowerCase();
    const name = agent.name.toLowerCase();
    const words = lower.split(/\s+/).filter(w => w.length > 3);

    for (const word of words) {
      if (desc.includes(word) || name.includes(word)) {
        if (!selected.find(s => s.agent.id === agent.id)) {
          selected.push({ agent, reason: `Description match: "${word}"`, priority: word.length });
        }
      }
    }
  }

  // Sort by priority (longer match = more specific = higher priority)
  selected.sort((a, b) => b.priority - a.priority);

  return {
    shouldDispatch: selected.length > 0,
    selectedAgents: selected.slice(0, 5), // Max 5 agents
    estimatedCost: selected.length * 0.01, // Rough estimate
  };
}

export async function autoDispatchAgents(
  message: string,
  provider: Provider,
  apiKeys: Partial<Record<Provider, string>>,
  model: string,
  workingDir: string,
  settings: Settings,
  systemPrompt: string,
  messages: Message[],
  onProgress?: (msg: string) => void,
): Promise<string> {
  if (!settings.agentDispatch.enabled) {
    return '';
  }

  const registry = getAgentRegistry();
  const allAgents = registry.allAgents;

  // Analyze task
  const decision = analyzeTaskForAgents(message, allAgents);

  if (!decision.shouldDispatch) {
    return '';
  }

  const orchestrator = getOrchestrator();
  const selectedIds = decision.selectedAgents.map(a => a.agent.id);

  onProgress?.(`🤖 Auto-dispatching ${selectedIds.length} agents: ${selectedIds.join(', ')}`);

  try {
    const state = await orchestrator.runOrchestration({
      mode: settings.agentDispatch.dispatchStrategy === 'parallel' ? 'full' : 'sprint',
      primaryAgent: selectedIds[0],
      supportingAgents: selectedIds.slice(1),
      maxRetries: settings.agentDispatch.maxRetries,
      qualityGates: settings.agentDispatch.qualityGate,
    }, message, provider, apiKeys, model, workingDir, systemPrompt, 15);

    // Build results summary
    let results = `\n\n## Auto-Dispatch Results\n\n`;
    results += `Agents dispatched: ${state.completedTasks.length}\n`;
    results += `Failed: ${state.failedTasks.length}\n`;
    results += `Duration: ${((Date.now() - state.startTime) / 1000).toFixed(1)}s\n\n`;

    for (const task of state.completedTasks) {
      results += `### ${task.agentName}\n${task.output.slice(0, 1000)}\n\n`;
    }

    onProgress?.(`✅ Auto-dispatch complete: ${state.completedTasks.length} agents finished`);
    return results;
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    onProgress?.(`⚠️ Auto-dispatch failed: ${errorMsg}`);
    return `\n\nAuto-dispatch encountered an error: ${errorMsg}\n`;
  }
}
