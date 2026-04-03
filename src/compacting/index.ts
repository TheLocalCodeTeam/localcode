// src/compacting/index.ts
// Conversation compacting to manage context window limits

import type { Message } from '../core/types.js';
import { streamProvider } from '../providers/client.js';
import type { Provider } from '../core/types.js';
import { logger } from '../core/logger.js';

export interface CompactConfig {
  provider: Provider;
  apiKeys: Partial<Record<Provider, string>>;
  model: string;
  systemPrompt: string;
  threshold: number; // Number of messages before compacting
  keepRecent: number; // Number of recent messages to keep un-compacted
}

export interface CompactResult {
  summary: string;
  compactedMessages: number;
  remainingMessages: number;
  tokensSaved: number;
}

/**
 * Compact a conversation by summarizing old messages and keeping recent context.
 */
export async function compactConversation(
  messages: Message[],
  config: CompactConfig,
): Promise<CompactResult> {
  if (messages.length <= config.threshold) {
    return {
      summary: '',
      compactedMessages: 0,
      remainingMessages: messages.length,
      tokensSaved: 0,
    };
  }

  // Keep the system prompt and recent messages
  const systemMessages = messages.filter(m => m.role === 'system');
  const recentMessages = messages.slice(-config.keepRecent);
  const messagesToCompact = messages.filter(
    m => m.role !== 'system' && !recentMessages.includes(m)
  );

  if (messagesToCompact.length === 0) {
    return {
      summary: '',
      compactedMessages: 0,
      remainingMessages: messages.length,
      tokensSaved: 0,
    };
  }

  // Build summary prompt
  const summaryPrompt = `Summarize the following conversation in 3-5 concise sentences, preserving key decisions, code context, goals, and any important technical details. Do NOT include pleasantries or filler.\n\n${messagesToCompact.map(m => `${m.role}: ${m.content.slice(0, 1000)}`).join('\n\n')}`;

  let summary = '';
  try {
    await streamProvider(
      config.provider,
      config.apiKeys,
      config.model,
      [{ role: 'user', content: summaryPrompt }],
      (chunk) => { if (chunk.text) summary += chunk.text; },
      config.systemPrompt,
    );
  } catch (err) {
    logger.warn('Conversation compacting failed', { error: err instanceof Error ? err.message : String(err) });
    summary = `[Conversation compacting failed - keeping original messages]`;
  }

  // Calculate tokens saved (rough estimate)
  const originalTokens = messagesToCompact.reduce((acc, m) => acc + m.content.length, 0) / 4;
  const summaryTokens = summary.length / 4;
  const tokensSaved = Math.max(0, Math.round(originalTokens - summaryTokens));

  logger.info('Conversation compacted', {
    compactedMessages: messagesToCompact.length,
    remainingMessages: recentMessages.length,
    tokensSaved,
    summaryLength: summary.length,
  });

  return {
    summary: summary.trim(),
    compactedMessages: messagesToCompact.length,
    remainingMessages: recentMessages.length,
    tokensSaved,
  };
}

/**
 * Build a message array with compacted conversation.
 */
export function buildCompactedMessages(
  messages: Message[],
  summary: string,
  config: CompactConfig,
): Message[] {
  const systemMessages = messages.filter(m => m.role === 'system');
  const recentMessages = messages.slice(-config.keepRecent);

  const compactedMessage: Message = {
    role: 'system',
    content: `[Previous conversation summary]\n${summary}`,
  };

  return [...systemMessages, compactedMessage, ...recentMessages];
}

/**
 * Check if conversation needs compacting.
 */
export function needsCompacting(messages: Message[], threshold: number): boolean {
  return messages.length > threshold;
}
