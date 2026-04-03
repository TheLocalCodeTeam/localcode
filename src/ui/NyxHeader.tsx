// src/ui/NyxHeader.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { NyxMood, Provider, PROVIDERS, ApprovalMode } from '../types/index.js';

const NYX_ART: Record<NyxMood, string[]> = {
  idle:     [' /\\_/\\ ', '( ·.· )', ' > ♥ < '],
  thinking: [' /\\_/\\ ', '( ?.? )', ' > ~ < '],
  happy:    [' /\\_/\\ ', '( ^.^ )', ' > ★ < '],
  error:    [' /\\_/\\ ', '( ×.× )', ' > ! < '],
  waiting:  [' /\\_/\\ ', '( -.o )', ' > … < '],
};

const PROVIDER_COLORS: Record<Provider, string> = {
  ollama: 'gray',
  claude: '#e8760a',
  openai: 'green',
  groq: 'red',
};

interface NyxHeaderProps {
  mood: NyxMood;
  provider: Provider;
  model: string;
  workingDir: string;
  tokenCount: number;
  approvalMode: ApprovalMode;
  persona: string | null;
  sessionCost: number;
  version?: string;
  maxTokens?: number;
  liveTokens?: number;
}

function tokenBar(count: number, max: number, width = 10): string {
  const pct = Math.min(1, count / max);
  const filled = Math.round(pct * width);
  return '▓'.repeat(filled) + '░'.repeat(width - filled) + ` ${Math.round(pct * 100)}%`;
}

export function NyxHeader({
  mood,
  provider,
  model,
  workingDir,
  tokenCount,
  approvalMode,
  persona,
  sessionCost,
  version = '3.0.0',
  maxTokens = 100_000,
  liveTokens,
}: NyxHeaderProps): React.ReactElement {
  const art = NYX_ART[mood];
  const providerConfig = PROVIDERS[provider];
  const shortDir = workingDir.replace(process.env.HOME ?? '', '~');

  const artColor = mood === 'error' ? 'red' : mood === 'happy' ? 'yellowBright' : mood === 'waiting' ? 'cyan' : 'white';
  const tokenColor = tokenCount > maxTokens * 0.8 ? 'red' : tokenCount > maxTokens * 0.5 ? 'yellow' : 'white';
  const moodColor = mood === 'error' ? 'red' : mood === 'thinking' ? 'yellow' : mood === 'happy' ? 'greenBright' : 'gray';
  const bar = tokenBar(tokenCount, maxTokens);

  return (
    <Box flexDirection="row" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={0}>
      {/* Nyx ASCII art */}
      <Box flexDirection="column" marginRight={2}>
        {art.map((line, i) => (
          <Text key={i} color={artColor}>{line}</Text>
        ))}
      </Box>

      {/* Info column */}
      <Box flexDirection="column" flexGrow={1}>

        {/* Title row */}
        <Box flexDirection="row">
          <Text bold color="yellowBright">LocalCode</Text>
          <Text color="gray" dimColor>  v{version}  ·  open source</Text>
        </Box>

        {/* Provider + model */}
        <Box flexDirection="row">
          <Text color="gray" dimColor>provider  </Text>
          <Text color={PROVIDER_COLORS[provider] as any} bold>{providerConfig.displayName}</Text>
          <Text color="gray" dimColor>  {model}</Text>
        </Box>

        {/* Working dir */}
        <Box flexDirection="row">
          <Text color="gray" dimColor>cwd       </Text>
          <Text color="cyan">{shortDir}</Text>
        </Box>

        {/* Tokens + badges */}
        <Box flexDirection="row">
          <Text color="gray" dimColor>tokens    </Text>
          <Text color={tokenColor}>{tokenCount.toLocaleString()}</Text>
          {liveTokens !== undefined && liveTokens > 0 && (
            <Text color="yellowBright"> +{liveTokens.toLocaleString()}▌</Text>
          )}
          <Text color={tokenColor} dimColor>  {bar}</Text>
          {approvalMode === 'auto-edit' && <Text color="yellow">  ⚡ auto-edit</Text>}
          {approvalMode === 'full-auto' && <Text color="red">  ⚡ full-auto</Text>}
          {persona && persona !== 'pair-programmer' && <Text color="gray" dimColor>  ◐ {persona}</Text>}
          {sessionCost > 0 && <Text color="gray" dimColor>  ${sessionCost.toFixed(4)}</Text>}
        </Box>
      </Box>

      {/* Mood indicator */}
      <Box alignSelf="center" marginLeft={1}>
        <Text color={moodColor} dimColor={mood === 'idle'}>[{mood}]</Text>
      </Box>
    </Box>
  );
}
