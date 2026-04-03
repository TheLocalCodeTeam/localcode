// src/ui/NyxHeader.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PROVIDERS } from '../types/index.js';
const NYX_ART = {
    idle: [' /\\_/\\ ', '( ·.· )', ' > ♥ < '],
    thinking: [' /\\_/\\ ', '( ?.? )', ' > ~ < '],
    happy: [' /\\_/\\ ', '( ^.^ )', ' > ★ < '],
    error: [' /\\_/\\ ', '( ×.× )', ' > ! < '],
    waiting: [' /\\_/\\ ', '( -.o )', ' > … < '],
};
const PROVIDER_COLORS = {
    ollama: 'gray',
    claude: '#e8760a',
    openai: 'green',
    groq: 'red',
};
function tokenBar(count, max, width = 10) {
    const pct = Math.min(1, count / max);
    const filled = Math.round(pct * width);
    return '▓'.repeat(filled) + '░'.repeat(width - filled) + ` ${Math.round(pct * 100)}%`;
}
export function NyxHeader({ mood, provider, model, workingDir, tokenCount, approvalMode, persona, sessionCost, version = '3.0.0', maxTokens = 100_000, liveTokens, }) {
    const art = NYX_ART[mood];
    const providerConfig = PROVIDERS[provider];
    const shortDir = workingDir.replace(process.env.HOME ?? '', '~');
    const artColor = mood === 'error' ? 'red' : mood === 'happy' ? 'yellowBright' : mood === 'waiting' ? 'cyan' : 'white';
    const tokenColor = tokenCount > maxTokens * 0.8 ? 'red' : tokenCount > maxTokens * 0.5 ? 'yellow' : 'white';
    const moodColor = mood === 'error' ? 'red' : mood === 'thinking' ? 'yellow' : mood === 'happy' ? 'greenBright' : 'gray';
    const bar = tokenBar(tokenCount, maxTokens);
    return (React.createElement(Box, { flexDirection: "row", borderStyle: "single", borderColor: "gray", paddingX: 1, marginBottom: 0 },
        React.createElement(Box, { flexDirection: "column", marginRight: 2 }, art.map((line, i) => (React.createElement(Text, { key: i, color: artColor }, line)))),
        React.createElement(Box, { flexDirection: "column", flexGrow: 1 },
            React.createElement(Box, { flexDirection: "row" },
                React.createElement(Text, { bold: true, color: "yellowBright" }, "LocalCode"),
                React.createElement(Text, { color: "gray", dimColor: true },
                    "  v",
                    version,
                    "  \u00B7  open source")),
            React.createElement(Box, { flexDirection: "row" },
                React.createElement(Text, { color: "gray", dimColor: true }, "provider  "),
                React.createElement(Text, { color: PROVIDER_COLORS[provider], bold: true }, providerConfig.displayName),
                React.createElement(Text, { color: "gray", dimColor: true },
                    "  ",
                    model)),
            React.createElement(Box, { flexDirection: "row" },
                React.createElement(Text, { color: "gray", dimColor: true }, "cwd       "),
                React.createElement(Text, { color: "cyan" }, shortDir)),
            React.createElement(Box, { flexDirection: "row" },
                React.createElement(Text, { color: "gray", dimColor: true }, "tokens    "),
                React.createElement(Text, { color: tokenColor }, tokenCount.toLocaleString()),
                liveTokens !== undefined && liveTokens > 0 && (React.createElement(Text, { color: "yellowBright" },
                    " +",
                    liveTokens.toLocaleString(),
                    "\u258C")),
                React.createElement(Text, { color: tokenColor, dimColor: true },
                    "  ",
                    bar),
                approvalMode === 'auto-edit' && React.createElement(Text, { color: "yellow" }, "  \u26A1 auto-edit"),
                approvalMode === 'full-auto' && React.createElement(Text, { color: "red" }, "  \u26A1 full-auto"),
                persona && persona !== 'pair-programmer' && React.createElement(Text, { color: "gray", dimColor: true },
                    "  \u25D0 ",
                    persona),
                sessionCost > 0 && React.createElement(Text, { color: "gray", dimColor: true },
                    "  $",
                    sessionCost.toFixed(4)))),
        React.createElement(Box, { alignSelf: "center", marginLeft: 1 },
            React.createElement(Text, { color: moodColor, dimColor: mood === 'idle' },
                "[",
                mood,
                "]"))));
}
//# sourceMappingURL=NyxHeader.js.map