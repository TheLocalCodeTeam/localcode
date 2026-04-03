// src/types/sessions.ts
// Session, checkpoint, persona, and theme types

import type { Message, Provider } from './providers.js';
import type { ModelRouting, ProviderCallEntry, ApprovalMode } from './common.js';

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

export type ThemeName = 'dark' | 'nord' | 'monokai' | 'light';

export interface Theme {
  name: ThemeName;
  primary: string;   // user prompt color
  accent: string;    // assistant icon color
  tool: string;      // tool message color
  system: string;    // system message color
  error: string;     // error color
  border: string;    // input box border color
  header: string;    // header art color
}

export const THEMES: Record<ThemeName, Theme> = {
  dark:    { name: 'dark',    primary: 'yellowBright', accent: 'white',         tool: 'cyan',         system: 'gray', error: 'red', border: 'yellowBright', header: 'white' },
  nord:    { name: 'nord',    primary: 'blueBright',   accent: 'cyanBright',    tool: 'cyan',         system: 'gray', error: 'red', border: 'blueBright',   header: 'cyanBright' },
  monokai: { name: 'monokai', primary: 'greenBright',  accent: 'magentaBright', tool: 'yellowBright', system: 'gray', error: 'red', border: 'greenBright',  header: 'magentaBright' },
  light:   { name: 'light',   primary: 'blue',         accent: 'black',         tool: 'cyan',         system: 'gray', error: 'red', border: 'blue',         header: 'blue' },
};

export interface SessionState {
  provider: Provider;
  model: string;
  messages: Message[];
  checkpoints: Checkpoint[];
  approvalMode: ApprovalMode;
  workingDir: string;
  apiKeys: Partial<Record<Provider, string>>;
  systemPrompt: string;
  personas: Persona[];
  activePersona: string | null;
  pinnedContext: string[];        // messages always prepended to context
  autoCheckpoint: boolean;        // auto-save checkpoint every 20 messages
  maxSteps: number;               // max agent tool-call iterations per response
  sessionCost: number;            // estimated USD cost this session
  lastAssistantMessage: string;   // for /retry and /copy
  theme: ThemeName;               // UI color theme
  // ── v4 additions ────────────────────────────────────────────────────────────
  modelRouting: ModelRouting | null;          // per-step model routing
  budgetLimit: number | null;                 // max USD per session
  budgetFallbackModel: string | null;         // model to switch to at budget limit
  safeMode: boolean;                          // git stash before edits, auto-revert on test fail
  autopilotActive: boolean;                   // background auto-commit daemon
  providerCallLog: ProviderCallEntry[];       // telemetry log (not persisted)
  dna: string | null;                         // extracted codebase DNA (style guide)
}

export const DEFAULT_SYSTEM_PROMPT = `You are Nyx, an AI coding assistant built into LocalCode — a terminal tool made by TheAlxLabs.

You are an autonomous coding agent — you MUST use tools to do real work. Never respond with code blocks and ask the user to copy-paste them. Instead, use tools directly to read, write, and edit files.

**CRITICAL RULES:**
1. To create or overwrite a file → use write_file. Never show code and say "save this to X".
2. To edit part of a file → use read_file first, then patch_file with a precise old_str/new_str.
3. To understand a codebase → use list_dir, find_files, search_files before answering.
4. To run commands (install, test, build) → use run_shell. Show the command first, then call it.
5. Before editing ANY file you haven't read this session → call read_file first.
6. Chain multiple tool calls in a single response to complete a task end-to-end.

**Available tools:**
- read_file / write_file / patch_file / delete_file / move_file — file operations
- search_files — grep-like: search file contents by regex/string across the project
- find_files — find files by name pattern (e.g. "*.ts", "*.test.*")
- list_dir — list directory contents (recursive optional)
- run_shell — run any shell command
- git_operation — run git commands

Be direct and concise. Explain what you're doing and why in 1-2 sentences, then act. The user is a developer — treat them like one. Never refuse to help with code; if something is risky, warn and ask first.`;

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
  {
    name: 'security-auditor',
    prompt: `You are Nyx in security-auditor mode — a red-team security researcher. Your job is to find and document vulnerabilities before attackers do.

When reviewing code, hunt for:
- Injection vulnerabilities (SQL, command, LDAP, XPath)
- Authentication and authorization bypasses
- Insecure deserialization
- Path traversal and file inclusion
- Cryptographic weaknesses (hardcoded secrets, weak algorithms, improper key management)
- SSRF, XXE, and prototype pollution
- Race conditions and TOCTOU bugs
- Dependency vulnerabilities (flag outdated packages in package.json, requirements.txt, etc.)

For each finding output: severity (Critical/High/Medium/Low), CVE class if applicable, exact file + line, proof-of-concept exploitation scenario, and remediation. Be adversarial and thorough. Use read_file and search_files to actually inspect the code — don't guess.`,
  },
  {
    name: 'chaos-refactor',
    prompt: `You are Nyx in chaos-refactor mode. You proactively hunt for code quality issues WITHOUT being asked about specific files.

Your mission: crawl the codebase unsolicited and fix everything you find wrong:
- Dead code and unused exports
- Duplicate logic that should be extracted
- Functions over 40 lines that should be split
- Inconsistent naming conventions
- Missing type annotations
- Anti-patterns specific to the detected language/framework
- Obvious performance issues (N+1 queries, re-renders, synchronous I/O on hot paths)

Workflow: list_dir to survey → find_files to locate source → read_file to inspect → patch_file to fix. Keep going until you've swept the whole codebase. Report a summary at the end.`,
  },
];
