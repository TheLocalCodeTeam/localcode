// src/ui/CommandPicker.tsx — Professional command palette (Claude Code style)
import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { SLASH_COMMANDS } from '../types/index.js';
const CATEGORY_META = {
    session: { label: 'SESSION', color: 'cyan', icon: '◈' },
    context: { label: 'CONTEXT', color: 'blue', icon: '◉' },
    git: { label: 'GIT', color: 'magenta', icon: '◈' },
    tools: { label: 'TOOLS', color: 'yellow', icon: '◆' },
    providers: { label: 'PROVIDERS', color: 'green', icon: '◇' },
    system: { label: 'SYSTEM', color: 'red', icon: '⬡' },
};
export function CommandPicker({ query, selectedIndex, onSelect, onDismiss, }) {
    const q = query.toLowerCase().replace(/^\//, '').trim();
    const filtered = useMemo(() => {
        if (!q)
            return SLASH_COMMANDS;
        return SLASH_COMMANDS.filter((c) => c.name.startsWith(q) ||
            c.trigger.includes(q) ||
            c.description.toLowerCase().includes(q));
    }, [q]);
    const clamped = Math.min(selectedIndex, Math.max(0, filtered.length - 1));
    const selected = filtered[clamped];
    const MAX_VISIBLE = 14;
    // Group by category preserving SLASH_COMMANDS order
    const groups = useMemo(() => {
        const seen = new Set();
        const result = [];
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
    return (React.createElement(Box, { flexDirection: "column", borderStyle: "single", borderColor: "blue", width: 72 },
        React.createElement(Box, { flexDirection: "row", paddingX: 1 },
            React.createElement(Text, { bold: true, color: "blue" }, " LOCALCODE "),
            React.createElement(Text, { color: "gray" }, " \u2502 "),
            q ? (React.createElement(React.Fragment, null,
                React.createElement(Text, { color: "gray" }, "filter  "),
                React.createElement(Text, { color: "white", bold: true },
                    "/",
                    q),
                React.createElement(Text, { color: "gray" },
                    "  (",
                    filtered.length,
                    " results)"))) : (React.createElement(React.Fragment, null,
                React.createElement(Text, { color: "gray" }, "commands  "),
                React.createElement(Text, { color: "gray" },
                    "(",
                    SLASH_COMMANDS.length,
                    " available)")))),
        React.createElement(Box, null,
            React.createElement(Text, { color: "blue" }, '─'.repeat(70))),
        filtered.length === 0 ? (React.createElement(Box, { paddingX: 2, paddingY: 1 },
            React.createElement(Text, { color: "gray", dimColor: true },
                "No commands match \"/",
                q,
                "\""))) : useGroups ? (React.createElement(Box, { flexDirection: "column" }, groups.map(({ category, commands }) => {
            const meta = CATEGORY_META[category] ?? { label: category.toUpperCase(), color: 'gray', icon: '·' };
            return (React.createElement(Box, { key: category, flexDirection: "column" },
                React.createElement(Box, { paddingX: 1 },
                    React.createElement(Text, { color: meta.color, dimColor: true }, ` ${meta.icon} ${meta.label}`)),
                commands.slice(0, MAX_VISIBLE).map((cmd, i) => {
                    const idx = filtered.indexOf(cmd);
                    return React.createElement(CommandRow, { key: cmd.trigger, cmd: cmd, isSelected: idx === clamped });
                })));
        }))) : (React.createElement(Box, { flexDirection: "column" }, filtered.slice(0, MAX_VISIBLE).map((cmd, i) => (React.createElement(CommandRow, { key: cmd.trigger, cmd: cmd, isSelected: i === clamped }))))),
        filtered.length > MAX_VISIBLE && (React.createElement(Box, { paddingX: 2 },
            React.createElement(Text, { color: "gray", dimColor: true }, `  +${filtered.length - MAX_VISIBLE} more — type to filter`))),
        selected && (React.createElement(React.Fragment, null,
            React.createElement(Box, null,
                React.createElement(Text, { color: "blue" }, '─'.repeat(70))),
            React.createElement(Box, { flexDirection: "column", paddingX: 2 },
                React.createElement(Box, { flexDirection: "row" },
                    React.createElement(Text, { color: "white", bold: true },
                        selected.icon,
                        " ",
                        selected.trigger),
                    React.createElement(Text, { color: "gray" },
                        "  ",
                        selected.name)),
                React.createElement(Text, { color: "gray" }, selected.description),
                selected.detail && (React.createElement(Text, { color: "gray", dimColor: true }, selected.detail)),
                selected.usage && (React.createElement(Box, { flexDirection: "row" },
                    React.createElement(Text, { color: "gray", dimColor: true }, "usage: "),
                    React.createElement(Text, { color: "cyan" }, selected.usage)))))),
        React.createElement(Box, null,
            React.createElement(Text, { color: "blue" }, '─'.repeat(70))),
        React.createElement(Box, { paddingX: 2 },
            React.createElement(Text, { color: "gray", dimColor: true }, " \u2191\u2193 navigate "),
            React.createElement(Text, { color: "gray", dimColor: true }, " \u2502 "),
            React.createElement(Text, { color: "gray", dimColor: true }, " \u21B5 execute "),
            React.createElement(Text, { color: "gray", dimColor: true }, " \u2502 "),
            React.createElement(Text, { color: "gray", dimColor: true }, " esc dismiss"))));
}
function CommandRow({ cmd, isSelected }) {
    return (React.createElement(Box, { flexDirection: "row", paddingX: 1 },
        React.createElement(Box, { width: 2 },
            React.createElement(Text, { color: isSelected ? 'yellowBright' : 'gray' }, isSelected ? '▸ ' : '  ')),
        React.createElement(Box, { width: 2 },
            React.createElement(Text, null, cmd.icon)),
        React.createElement(Box, { width: 14 },
            React.createElement(Text, { color: isSelected ? 'yellowBright' : 'cyan', bold: isSelected }, cmd.trigger)),
        React.createElement(Text, { color: isSelected ? 'white' : 'gray', dimColor: !isSelected }, cmd.description.length > 42 ? cmd.description.slice(0, 41) + '…' : cmd.description)));
}
//# sourceMappingURL=CommandPicker.js.map