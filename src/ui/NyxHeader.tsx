// src/ui/NyxHeader.tsx

import React from 'react';
import { Box, Text } from 'ink';
import { NyxMood, Provider, PROVIDERS } from '../core/types.js';

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
  allowAll: boolean;
  persona: string | null;
  sessionCost: number;
}

export function NyxHeader({
  mood,
  provider,
  model,
  workingDir,
  tokenCount,
  allowAll,
  persona,
  sessionCost,
}: NyxHeaderProps): React.ReactElement {
  const art = NYX_ART[mood];
  const providerConfig = PROVIDERS[provider];
  const shortDir = workingDir.replace(process.env.HOME ?? '', '~');

  return (
    <Box flexDirection="row" borderStyle="single" borderColor="gray" paddingX={1} marginBottom={1}>
      {/* Nyx ASCII */}
      <Box flexDirection="column" marginRight={2}>
        {art.map((line, i) => (
          <Text key={i} color={mood === 'error' ? 'red' : mood === 'happy' ? 'yellowBright' : 'white'}>
            {line}
          </Text>
        ))}
      </Box>

      {/* Info column */}
      <Box flexDirection="column" flexGrow={1}>
        {/* Title + version */}
        <Box flexDirection="row" marginBottom={0}>
          <Text bold color="yellowBright">LocalCode</Text>
          <Text color="gray" dimColor>  v2.1  @localcode/cli</Text>
        </Box>

        {/* Provider + model */}
        <Box flexDirection="row">
          <Text color="gray" dimColor>provider  </Text>
          <Text color={PROVIDER_COLORS[provider] as any} bold>
            {providerConfig.displayName}
          </Text>
          <Text color="gray" dimColor>  {model}</Text>
        </Box>

        {/* Working dir */}
        <Box flexDirection="row">
          <Text color="gray" dimColor>cwd       </Text>
          <Text color="cyan">{shortDir}</Text>
        </Box>

        {/* Tokens + flags */}
        <Box flexDirection="row">
          <Text color="gray" dimColor>tokens    </Text>
          <Text color={tokenCount > 100000 ? 'red' : tokenCount > 50000 ? 'yellow' : 'white'}>
            {tokenCount.toLocaleString()}
          </Text>
          {persona && <Text color="gray" dimColor>  ◐ {persona}</Text>}
          {allowAll && <Text color="yellow" dimColor>  ✓ allowall</Text>}
          {sessionCost > 0 && <Text color="gray" dimColor>  ${sessionCost.toFixed(4)}</Text>}
        </Box>
      </Box>

      {/* Mood label */}
      <Box alignSelf="center" marginLeft={1}>
        <Text color="gray" dimColor>[{mood}]</Text>
      </Box>
    </Box>
  );
}
