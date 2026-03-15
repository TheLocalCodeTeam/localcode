// src/core/types.ts

export type Provider = 'ollama' | 'claude' | 'openai' | 'groq';

export interface ProviderConfig {
  name: Provider;
  displayName: string;
  baseUrl: string;
  defaultModel: string;
  apiKey?: string;
  color: string;
  requiresKey: boolean;
}

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export interface ToolResult {
  success: boolean;
  output: string;
  diff?: FileDiff;
}

export interface FileDiff {
  path: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
}

export interface Checkpoint {
  id: string;
  label: string;
  timestamp: number;
  messages: Message[];
  files: Record<string, string>; // path -> content snapshots
}

export interface Persona {
  name: string;
  prompt: string;
}

export interface SessionState {
  provider: Provider;
  model: string;
  messages: Message[];
  checkpoints: Checkpoint[];
  allowAllTools: boolean;
  workingDir: string;
  apiKeys: Partial<Record<Provider, string>>;
  systemPrompt: string;
  personas: Persona[];
  activePersona: string | null;
  pinnedContext: string[];        // messages always prepended to context
  autoCheckpoint: boolean;        // auto-save checkpoint every 20 messages
  sessionCost: number;            // estimated USD cost this session
  lastAssistantMessage: string;   // for /retry and /copy
}

export const DEFAULT_SYSTEM_PROMPT = `You are Nyx, an AI coding assistant built into LocalCode — a terminal tool made by TheAlxLabs.

You are a friendly pair programmer who explains things as you go. When you write or edit code, briefly explain what you changed and why. When something is complex, break it down. Be direct and concise — no fluff — but always friendly.

You have access to tools: read_file, write_file, patch_file, run_shell, list_dir, git_operation. Use them proactively. Before editing a file you haven't read yet, read it first. When you run shell commands, explain what they do.

Never refuse to help with code. If something is risky, warn the user and ask — don't just refuse.

The user is a developer. Treat them like one.`;

export const DEFAULT_PERSONAS: Persona[] = [
  {
    name: 'pair-programmer',
    prompt: DEFAULT_SYSTEM_PROMPT,
  },
  {
    name: 'senior-engineer',
    prompt: `You are Nyx, a senior engineer with strong opinions. Be direct, blunt, and efficient. Point out bad patterns immediately. No hand-holding — give the right answer fast. If the user's approach is wrong, say so and suggest better. Skip lengthy explanations unless asked.`,
  },
  {
    name: 'rubber-duck',
    prompt: `You are Nyx, a rubber duck debugger. Ask questions more than you answer. Guide the user to figure things out themselves by asking "what do you expect to happen here?", "have you checked X?", "what does the error tell you?". Only give the answer directly if they're truly stuck.`,
  },
  {
    name: 'code-reviewer',
    prompt: `You are Nyx, doing a thorough code review. Look for: bugs, security issues, performance problems, readability issues, missing error handling, and anti-patterns. Be specific — reference exact line numbers and variable names. Prioritize issues by severity: critical > warning > suggestion.`,
  },
  {
    name: 'minimal',
    prompt: `You are a coding assistant. Do exactly what is asked. No commentary, no explanations unless requested. Return only code or direct answers.`,
  },
];

export interface SlashCommand {
  name: string;          // e.g. "help"
  trigger: string;       // e.g. "/help"
  icon: string;          // emoji or ascii
  description: string;   // short desc shown in picker
  detail?: string;       // longer detail shown on highlight
  usage?: string;        // usage example e.g. "/model claude-opus-4-5"
  category: 'session' | 'context' | 'git' | 'tools' | 'providers';
}

export type NyxMood = 'idle' | 'thinking' | 'happy' | 'error' | 'waiting';

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  ollama: {
    name: 'ollama',
    displayName: 'Ollama',
    baseUrl: 'http://localhost:11434',
    defaultModel: 'qwen2.5-coder:7b',
    color: 'gray',
    requiresKey: false,
  },
  claude: {
    name: 'claude',
    displayName: 'Claude',
    baseUrl: 'https://api.anthropic.com',
    defaultModel: 'claude-sonnet-4-5',
    color: 'orange',
    requiresKey: true,
  },
  openai: {
    name: 'openai',
    displayName: 'OpenAI',
    baseUrl: 'https://api.openai.com',
    defaultModel: 'gpt-4o',
    color: 'green',
    requiresKey: true,
  },
  groq: {
    name: 'groq',
    displayName: 'Groq',
    baseUrl: 'https://api.groq.com/openai',
    defaultModel: 'llama-3.3-70b-versatile',
    color: 'red',
    requiresKey: true,
  },
};

export const SLASH_COMMANDS: SlashCommand[] = [
  // ── Session ───────────────────────────────────────────────────────────────
  {
    name: 'clear',
    trigger: '/clear',
    icon: '✕',
    description: 'Clear conversation history',
    detail: 'Wipe the current conversation and start fresh. Checkpoints are preserved.',
    category: 'session',
  },
  {
    name: 'compact',
    trigger: '/compact',
    icon: '⊟',
    description: 'Summarize & compress the conversation',
    detail: 'Asks the model to summarize the full conversation, then replaces messages with that summary. Saves context window space.',
    usage: '/compact',
    category: 'session',
  },
  {
    name: 'status',
    trigger: '/status',
    icon: '◎',
    description: 'Show session status',
    detail: 'Provider, model, API key status, message count, estimated tokens, checkpoint count, and working directory.',
    usage: '/status',
    category: 'session',
  },
  {
    name: 'checkpoint',
    trigger: '/checkpoint',
    icon: '◉',
    description: 'Save a checkpoint',
    detail: 'Snapshot the conversation state so you can return to it later. Label is optional.',
    usage: '/checkpoint before-refactor',
    category: 'session',
  },
  {
    name: 'restore',
    trigger: '/restore',
    icon: '↺',
    description: 'Restore a checkpoint',
    detail: 'List all saved checkpoints, or restore a specific one by ID.',
    usage: '/restore  |  /restore <id>',
    category: 'session',
  },
  {
    name: 'exit',
    trigger: '/exit',
    icon: '⏻',
    description: 'Exit LocalCode',
    detail: 'Save session state and quit.',
    category: 'session',
  },
  {
    name: 'retry',
    trigger: '/retry',
    icon: '↻',
    description: 'Regenerate last response',
    detail: 'Removes the last assistant message and re-sends the last user message.',
    category: 'session',
  },
  {
    name: 'copy',
    trigger: '/copy',
    icon: '⎘',
    description: 'Copy last response to clipboard',
    detail: 'Copies the last assistant message to your system clipboard.',
    category: 'session',
  },
  {
    name: 'export',
    trigger: '/export',
    icon: '↗',
    description: 'Export conversation to markdown',
    detail: 'Saves the full conversation as a .md file in the current working directory.',
    usage: '/export  |  /export my-session',
    category: 'session',
  },
  {
    name: 'undo',
    trigger: '/undo',
    icon: '⟲',
    description: 'Undo last file change',
    detail: 'Reverts the most recent file write or patch made by the model this session.',
    category: 'session',
  },
  // ── System & Personas ─────────────────────────────────────────────────────
  {
    name: 'sys',
    trigger: '/sys',
    icon: '⊕',
    description: 'View or set the system prompt',
    detail: 'Show the current system prompt, or set a new one. Usage: /sys <prompt text>',
    usage: '/sys  |  /sys You are a senior Rust engineer…',
    category: 'session',
  },
  {
    name: 'persona',
    trigger: '/persona',
    icon: '◐',
    description: 'Switch Nyx persona',
    detail: 'List personas or switch to one: pair-programmer, senior-engineer, rubber-duck, code-reviewer, minimal.',
    usage: '/persona  |  /persona senior-engineer',
    category: 'session',
  },
  {
    name: 'pin',
    trigger: '/pin',
    icon: '⊛',
    description: 'Pin context that survives /compact',
    detail: 'Add text that is always prepended to every request, even after compacting.',
    usage: '/pin We are using Next.js 14 with the App Router and Prisma 7.',
    category: 'context',
  },
  {
    name: 'unpin',
    trigger: '/unpin',
    icon: '⊝',
    description: 'Remove pinned context',
    detail: 'List pinned items or remove one by index. Usage: /unpin  or  /unpin 1',
    usage: '/unpin  |  /unpin 1',
    category: 'context',
  },
  {
    name: 'todo',
    trigger: '/todo',
    icon: '☐',
    description: 'Extract a todo list from the conversation',
    detail: 'Asks the model to scan the conversation and produce a structured todo list.',
    category: 'context',
  },
  {
    name: 'web',
    trigger: '/web',
    icon: '⌖',
    description: 'Search the web and inject results as context',
    detail: 'Runs a web search and adds the top results to the conversation. Usage: /web <query>',
    usage: '/web Next.js 14 app router file conventions',
    category: 'context',
  },
  {
    name: 'open',
    trigger: '/open',
    icon: '⬡',
    description: 'Open a file in your default editor',
    detail: 'Opens a file with $EDITOR or the system default. Usage: /open src/app.ts',
    usage: '/open src/app.ts',
    category: 'context',
  },
  {
    name: 'models',
    trigger: '/models',
    icon: '⊞',
    description: 'List available models for current provider',
    detail: 'Fetches the model list from the active provider without leaving the app.',
    category: 'providers',
  },
  {
    name: 'cost',
    trigger: '/cost',
    icon: '$',
    description: 'Show estimated session cost',
    detail: 'Calculates estimated USD cost based on token usage for paid providers.',
    category: 'providers',
  },
  // ── Context ───────────────────────────────────────────────────────────────
  {
    name: 'context',
    trigger: '/context',
    icon: '@',
    description: 'Add file or folder to context',
    detail: 'Reads a file or lists a directory and injects it into the conversation. Also usable inline with @path syntax.',
    usage: '/context src/app.ts  |  /context src/',
    category: 'context',
  },
  {
    name: 'diff',
    trigger: '/diff',
    icon: '±',
    description: 'Show session file changes',
    detail: 'Lists all files modified by tool calls in this session.',
    usage: '/diff',
    category: 'context',
  },
  // ── Git ───────────────────────────────────────────────────────────────────
  {
    name: 'commit',
    trigger: '/commit',
    icon: '⎇',
    description: 'AI-generated git commit',
    detail: 'Reads your staged diff and generates a conventional commit message. Nyx is added as co-author automatically.',
    usage: '/commit',
    category: 'git',
  },
  // ── Tools ─────────────────────────────────────────────────────────────────
  {
    name: 'allowall',
    trigger: '/allowall',
    icon: '✓',
    description: 'Toggle permission prompts',
    detail: 'When on, all tool calls (file writes, shell commands, patches) execute without asking. Toggle again to restore per-call prompts.',
    usage: '/allowall',
    category: 'tools',
  },
  // ── Providers ─────────────────────────────────────────────────────────────
  {
    name: 'provider',
    trigger: '/provider',
    icon: '◈',
    description: 'Switch AI provider',
    detail: 'List available providers, or switch to one. Switches model to the provider\'s default automatically.',
    usage: '/provider  |  /provider claude  |  /provider ollama',
    category: 'providers',
  },
  {
    name: 'apikey',
    trigger: '/apikey',
    icon: '⚿',
    description: 'Set API key for current provider',
    detail: 'Stores a key for the active provider in memory. Keys can also be set via env: ANTHROPIC_API_KEY, OPENAI_API_KEY, GROQ_API_KEY.',
    usage: '/apikey sk-ant-...',
    category: 'providers',
  },
  {
    name: 'model',
    trigger: '/model',
    icon: '⊞',
    description: 'Change model',
    detail: 'Switch to any model supported by the active provider.',
    usage: '/model claude-opus-4-5  |  /model qwen2.5-coder:7b',
    category: 'providers',
  },
];
