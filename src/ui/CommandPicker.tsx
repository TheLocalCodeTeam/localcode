// src/ui/CommandPicker.tsx — Professional command palette (Claude Code style)

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { SlashCommand, SLASH_COMMANDS } from '../types/index.js';

const CATEGORY_META: Record<string, { label: string; color: string; icon: string }> = {
  session:   { label: 'SESSION',   color: 'cyan',    icon: '◈' },
  context:   { label: 'CONTEXT',   color: 'blue',    icon: '◉' },
  git:       { label: 'GIT',       color: 'magenta', icon: '◈' },
  tools:     { label: 'TOOLS',     color: 'yellow',  icon: '◆' },
  providers: { label: 'PROVIDERS', color: 'green',   icon: '◇' },
  system:    { label: 'SYSTEM',    color: 'red',     icon: '⬡' },
};

interface CommandPickerProps {
  query: string;
  selectedIndex: number;
  onSelect: (cmd: SlashCommand) => void;
  onDismiss: () => void;
}

export function CommandPicker({
  query,
  selectedIndex,
  onSelect,
  onDismiss,
}: CommandPickerProps): React.ReactElement {
  const q = query.toLowerCase().replace(/^\//, '').trim();

  const filtered = useMemo(() => {
    if (!q) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (c) =>
        c.name.startsWith(q) ||
        c.trigger.includes(q) ||
        c.description.toLowerCase().includes(q),
    );
  }, [q]);

  const clamped = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
  const selected = filtered[clamped];
  const MAX_VISIBLE = 14;

  // Group by category preserving SLASH_COMMANDS order
  const groups = useMemo(() => {
    const seen = new Set<string>();
    const result: Array<{ category: string; commands: SlashCommand[] }> = [];
    for (const cmd of filtered) {
      if (!seen.has(cmd.category)) {
        seen.add(cmd.category);
        result.push({
          category: cmd.category,
          commands: filtered.filter((c) => c.category === cmd.category),
        });
      }
    }
    return result;
  }, [filtered]);

  const useGroups = !q;

  return (
    <Box flexDirection="column" borderStyle="single" borderColor="blue" width={72}>
      {/* Header bar */}
      <Box flexDirection="row" paddingX={1}>
        <Text bold color="blue"> LOCALCODE </Text>
        <Text color="gray"> │ </Text>
        {q ? (
          <>
            <Text color="gray">filter  </Text>
            <Text color="white" bold>/{q}</Text>
            <Text color="gray">  ({filtered.length} results)</Text>
          </>
        ) : (
          <>
            <Text color="gray">commands  </Text>
            <Text color="gray">({SLASH_COMMANDS.length} available)</Text>
          </>
        )}
      </Box>

      {/* Separator */}
      <Box>
        <Text color="blue">{'─'.repeat(70)}</Text>
      </Box>

      {/* Command list */}
      {filtered.length === 0 ? (
        <Box paddingX={2} paddingY={1}>
          <Text color="gray" dimColor>No commands match "/{q}"</Text>
        </Box>
      ) : useGroups ? (
        <Box flexDirection="column">
          {groups.map(({ category, commands }) => {
            const meta = CATEGORY_META[category] ?? { label: category.toUpperCase(), color: 'gray', icon: '·' };
            return (
              <Box key={category} flexDirection="column">
                <Box paddingX={1}>
                  <Text color={meta.color as any} dimColor>{` ${meta.icon} ${meta.label}`}</Text>
                </Box>
                {commands.slice(0, MAX_VISIBLE).map((cmd, i) => {
                  const idx = filtered.indexOf(cmd);
                  return <CommandRow key={cmd.trigger} cmd={cmd} isSelected={idx === clamped} />;
                })}
              </Box>
            );
          })}
        </Box>
      ) : (
        <Box flexDirection="column">
          {filtered.slice(0, MAX_VISIBLE).map((cmd, i) => (
            <CommandRow key={cmd.trigger} cmd={cmd} isSelected={i === clamped} />
          ))}
        </Box>
      )}

      {filtered.length > MAX_VISIBLE && (
        <Box paddingX={2}>
          <Text color="gray" dimColor>{`  +${filtered.length - MAX_VISIBLE} more — type to filter`}</Text>
        </Box>
      )}

      {/* Detail pane */}
      {selected && (
        <>
          <Box>
            <Text color="blue">{'─'.repeat(70)}</Text>
          </Box>
          <Box flexDirection="column" paddingX={2}>
            <Box flexDirection="row">
              <Text color="white" bold>{selected.icon} {selected.trigger}</Text>
              <Text color="gray">  {selected.name}</Text>
            </Box>
            <Text color="gray">{selected.description}</Text>
            {selected.detail && (
              <Text color="gray" dimColor>{selected.detail}</Text>
            )}
            {selected.usage && (
              <Box flexDirection="row">
                <Text color="gray" dimColor>usage: </Text>
                <Text color="cyan">{selected.usage}</Text>
              </Box>
            )}
          </Box>
        </>
      )}

      {/* Footer */}
      <Box>
        <Text color="blue">{'─'.repeat(70)}</Text>
      </Box>
      <Box paddingX={2}>
        <Text color="gray" dimColor> ↑↓ navigate </Text>
        <Text color="gray" dimColor> │ </Text>
        <Text color="gray" dimColor> ↵ execute </Text>
        <Text color="gray" dimColor> │ </Text>
        <Text color="gray" dimColor> esc dismiss</Text>
      </Box>
    </Box>
  );
}

function CommandRow({ cmd, isSelected }: { cmd: SlashCommand; isSelected: boolean }): React.ReactElement {
  return (
    <Box flexDirection="row" paddingX={1}>
      <Box width={2}>
        <Text color={isSelected ? 'yellowBright' : 'gray'}>{isSelected ? '▸ ' : '  '}</Text>
      </Box>
      <Box width={2}>
        <Text>{cmd.icon}</Text>
      </Box>
      <Box width={14}>
        <Text color={isSelected ? 'yellowBright' : 'cyan'} bold={isSelected}>{cmd.trigger}</Text>
      </Box>
      <Text color={isSelected ? 'white' : 'gray'} dimColor={!isSelected}>
        {cmd.description.length > 42 ? cmd.description.slice(0, 41) + '…' : cmd.description}
      </Text>
    </Box>
  );
}
