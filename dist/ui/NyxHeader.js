// src/ui/NyxHeader.tsx
import React from 'react';
import { Box, Text } from 'ink';
import { PROVIDERS } from '../core/types.js';
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
export function NyxHeader({ mood, provider, model, workingDir, tokenCount, allowAll, persona, sessionCost, }) {
    const art = NYX_ART[mood];
    const providerConfig = PROVIDERS[provider];
    const shortDir = workingDir.replace(process.env.HOME ?? '', '~');
    return (React.createElement(Box, { flexDirection: "row", borderStyle: "single", borderColor: "gray", paddingX: 1, marginBottom: 1 },
        React.createElement(Box, { flexDirection: "column", marginRight: 2 }, art.map((line, i) => (React.createElement(Text, { key: i, color: mood === 'error' ? 'red' : mood === 'happy' ? 'yellowBright' : 'white' }, line)))),
        React.createElement(Box, { flexDirection: "column", flexGrow: 1 },
            React.createElement(Box, { flexDirection: "row", marginBottom: 0 },
                React.createElement(Text, { bold: true, color: "yellowBright" }, "LocalCode"),
                React.createElement(Text, { color: "gray", dimColor: true }, "  v2.1  @localcode/cli")),
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
                React.createElement(Text, { color: tokenCount > 100000 ? 'red' : tokenCount > 50000 ? 'yellow' : 'white' }, tokenCount.toLocaleString()),
                persona && React.createElement(Text, { color: "gray", dimColor: true },
                    "  \u25D0 ",
                    persona),
                allowAll && React.createElement(Text, { color: "yellow", dimColor: true }, "  \u2713 allowall"),
                sessionCost > 0 && React.createElement(Text, { color: "gray", dimColor: true },
                    "  $",
                    sessionCost.toFixed(4)))),
        React.createElement(Box, { alignSelf: "center", marginLeft: 1 },
            React.createElement(Text, { color: "gray", dimColor: true },
                "[",
                mood,
                "]"))));
}
//# sourceMappingURL=NyxHeader.js.map