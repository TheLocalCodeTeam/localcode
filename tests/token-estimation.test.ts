import { describe, it, expect } from 'vitest';
import { estimateTokens } from '../src/sessions/manager.js';
import type { Message } from '../src/core/types.js';

describe('estimateTokens', () => {
  it('should estimate tokens for simple text', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'Hello, how are you?' },
    ];
    const tokens = estimateTokens(msgs);
    expect(tokens).toBeGreaterThan(0);
    expect(tokens).toBeLessThan(20);
  });

  it('should estimate higher for code content', () => {
    const codeContent = `import { useState } from 'react';
export function App() {
  const [count, setCount] = useState(0);
  return <button onClick={() => setCount(c => c + 1)}>{count}</button>;
}`;
    const msgs: Message[] = [
      { role: 'user', content: codeContent },
    ];
    const tokens = estimateTokens(msgs);
    expect(tokens).toBeGreaterThan(0);
  });

  it('should handle empty messages', () => {
    const msgs: Message[] = [
      { role: 'user', content: '' },
    ];
    expect(estimateTokens(msgs)).toBe(0);
  });

  it('should handle multiple messages', () => {
    const msgs: Message[] = [
      { role: 'user', content: 'Explain this code' },
      { role: 'assistant', content: 'This is a React component that...' },
      { role: 'user', content: 'Thanks!' },
    ];
    const tokens = estimateTokens(msgs);
    expect(tokens).toBeGreaterThan(estimateTokens([{ role: 'user', content: 'Explain this code' }]));
  });

  it('should handle tool results with overhead', () => {
    const msgs: Message[] = [
      { role: 'assistant', content: 'Tool result: [file content here]' },
    ];
    const tokens = estimateTokens(msgs);
    expect(tokens).toBeGreaterThan(0);
  });
});
