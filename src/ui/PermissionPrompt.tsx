// src/ui/PermissionPrompt.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { ToolCall, ApprovalMode } from '../types/index.js';

interface PermissionPromptProps {
  toolCall: ToolCall;
}

const TOOL_DESCRIPTIONS: Record<string, string> = {
  write_file: 'Write file',
  patch_file: 'Patch file',
  delete_file: 'Delete file',
  move_file: 'Move file',
  run_shell: 'Run shell command',
  git_operation: 'Git operation',
  read_file: 'Read file',
  list_dir: 'List directory',
};

const SENSITIVE_TOOLS = new Set([
  'write_file',
  'patch_file',
  'delete_file',
  'move_file',
  'run_shell',
  'git_operation',
]);

export function needsApproval(toolCall: ToolCall, mode: ApprovalMode): boolean {
  switch (mode) {
    case 'full-auto':
      return false;
    case 'auto-edit':
      // Only shell needs approval; file ops are auto-approved
      return toolCall.name === 'run_shell';
    case 'suggest':
    default:
      return SENSITIVE_TOOLS.has(toolCall.name);
  }
}

// Backwards-compatible alias — always uses 'suggest' mode
export function needsPermission(toolCall: ToolCall): boolean {
  return needsApproval(toolCall, 'suggest');
}

function formatArgs(args: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === 'string' && v.length > 60) {
      parts.push(`${k}='${v.slice(0, 60)}…'`);
    } else {
      parts.push(`${k}='${v}'`);
    }
  }
  return parts.join('  ');
}

export function PermissionPrompt({ toolCall }: PermissionPromptProps): React.ReactElement {
  const desc = TOOL_DESCRIPTIONS[toolCall.name] ?? toolCall.name;
  const argStr = formatArgs(toolCall.args);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Box flexDirection="row" marginBottom={1}>
        <Text color="yellow" bold>⚠  Permission required</Text>
      </Box>

      <Box flexDirection="row">
        <Text color="gray" dimColor>Tool   </Text>
        <Text color="yellowBright" bold>{desc}</Text>
      </Box>

      {argStr && (
        <Box flexDirection="row">
          <Text color="gray" dimColor>Args   </Text>
          <Text color="white">{argStr}</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text color="gray">
          {'  '}
          <Text color="greenBright" bold>y</Text>
          <Text color="gray">  allow once    </Text>
          <Text color="yellow" bold>a</Text>
          <Text color="gray">  allow all this session    </Text>
          <Text color="red" bold>n</Text>
          <Text color="gray">  deny</Text>
        </Text>
      </Box>
    </Box>
  );
}
