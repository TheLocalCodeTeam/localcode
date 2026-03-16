// src/ui/MarkdownText.tsx
// Terminal markdown renderer for Ink — code blocks, headers, bold, inline code, lists

import React from 'react';
import { Box, Text } from 'ink';

// ─── Inline segment parser ────────────────────────────────────────────────────

interface Segment {
  text: string;
  bold?: boolean;
  code?: boolean;
  italic?: boolean;
}

function parseInline(raw: string): Segment[] {
  const segments: Segment[] = [];
  let remaining = raw;

  while (remaining.length > 0) {
    // Bold **...**
    const boldIdx = remaining.indexOf('**');
    // Inline code `...`
    const codeIdx = remaining.indexOf('`');

    const first = Math.min(
      boldIdx === -1 ? Infinity : boldIdx,
      codeIdx === -1 ? Infinity : codeIdx,
    );

    if (first === Infinity) {
      segments.push({ text: remaining });
      break;
    }

    if (first > 0) {
      segments.push({ text: remaining.slice(0, first) });
      remaining = remaining.slice(first);
      continue;
    }

    // Inline code
    if (codeIdx === 0) {
      const end = remaining.indexOf('`', 1);
      if (end !== -1) {
        segments.push({ text: remaining.slice(1, end), code: true });
        remaining = remaining.slice(end + 1);
        continue;
      }
    }

    // Bold
    if (boldIdx === 0) {
      const end = remaining.indexOf('**', 2);
      if (end !== -1) {
        segments.push({ text: remaining.slice(2, end), bold: true });
        remaining = remaining.slice(end + 2);
        continue;
      }
    }

    // No matching close — treat as literal
    segments.push({ text: remaining[0] });
    remaining = remaining.slice(1);
  }

  return segments.filter((s) => s.text.length > 0);
}

// ─── Inline text renderer ─────────────────────────────────────────────────────

function InlineText({ text, baseColor = 'white' }: { text: string; baseColor?: string }): React.ReactElement {
  const segments = parseInline(text);
  if (segments.length === 1 && !segments[0].bold && !segments[0].code) {
    return <Text color={baseColor as any}>{segments[0].text}</Text>;
  }
  return (
    <Text>
      {segments.map((seg, i) => {
        if (seg.code) {
          return (
            <Text key={i} color="greenBright">{`\`${seg.text}\``}</Text>
          );
        }
        if (seg.bold) {
          return <Text key={i} bold color={baseColor as any}>{seg.text}</Text>;
        }
        return <Text key={i} color={baseColor as any}>{seg.text}</Text>;
      })}
    </Text>
  );
}

// ─── Block renderer ───────────────────────────────────────────────────────────

interface MarkdownTextProps {
  content: string;
  baseColor?: string;
  streaming?: boolean;
}

export function MarkdownText({ content, baseColor = 'white', streaming = false }: MarkdownTextProps): React.ReactElement {
  const lines = content.split('\n');
  const elements: React.ReactElement[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // ── Fenced code block ──────────────────────────────────────────────────
    if (line.trimStart().startsWith('```')) {
      const lang = line.trimStart().slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trimStart().startsWith('```')) {
        codeLines.push(lines[i]);
        i++;
      }
      const code = codeLines.join('\n');
      elements.push(
        <Box
          key={`cb-${i}`}
          flexDirection="column"
          borderStyle="single"
          borderColor="gray"
          paddingX={1}
          marginY={0}
        >
          {lang ? (
            <Text color="gray" dimColor>{lang}</Text>
          ) : null}
          <Text color="greenBright">{code}</Text>
        </Box>,
      );
      i++; // skip closing ```
      continue;
    }

    // ── Horizontal rule ────────────────────────────────────────────────────
    if (/^[-*_]{3,}\s*$/.test(line.trim())) {
      elements.push(
        <Text key={`hr-${i}`} color="gray" dimColor>
          {'─'.repeat(50)}
        </Text>,
      );
      i++;
      continue;
    }

    // ── ATX Headers ────────────────────────────────────────────────────────
    const h1 = line.match(/^# (.+)/);
    const h2 = line.match(/^## (.+)/);
    const h3 = line.match(/^### (.+)/);
    const h4 = line.match(/^#{4,} (.+)/);

    if (h1) {
      elements.push(
        <Box key={`h1-${i}`} flexDirection="row" marginTop={0}>
          <Text bold color="yellowBright">{'▌ '}</Text>
          <Text bold color="yellowBright">{h1[1]}</Text>
        </Box>,
      );
      i++; continue;
    }
    if (h2) {
      elements.push(
        <Box key={`h2-${i}`} flexDirection="row">
          <Text bold color="cyan">{'  ◈ '}</Text>
          <Text bold color="cyan">{h2[1]}</Text>
        </Box>,
      );
      i++; continue;
    }
    if (h3) {
      elements.push(
        <Box key={`h3-${i}`} flexDirection="row">
          <Text bold color="white">{'    › '}</Text>
          <Text bold color="white">{h3[1]}</Text>
        </Box>,
      );
      i++; continue;
    }
    if (h4) {
      elements.push(
        <Box key={`h4-${i}`} flexDirection="row">
          <Text color="gray">{'      · '}</Text>
          <Text bold color="gray">{h4[1]}</Text>
        </Box>,
      );
      i++; continue;
    }

    // ── Unordered list ─────────────────────────────────────────────────────
    const ulMatch = line.match(/^(\s*)[-*+] (.+)/);
    if (ulMatch) {
      const indent = ulMatch[1].length;
      const bullet = indent === 0 ? '  ·' : indent <= 2 ? '    ◦' : '      ▸';
      elements.push(
        <Box key={`ul-${i}`} flexDirection="row">
          <Text color="gray">{bullet + ' '}</Text>
          <InlineText text={ulMatch[2]} baseColor={baseColor} />
        </Box>,
      );
      i++; continue;
    }

    // ── Ordered list ───────────────────────────────────────────────────────
    const olMatch = line.match(/^(\s*)(\d+)\. (.+)/);
    if (olMatch) {
      elements.push(
        <Box key={`ol-${i}`} flexDirection="row">
          <Text color="gray">{`  ${olMatch[2]}. `}</Text>
          <InlineText text={olMatch[3]} baseColor={baseColor} />
        </Box>,
      );
      i++; continue;
    }

    // ── Blockquote ─────────────────────────────────────────────────────────
    const bqMatch = line.match(/^> (.+)/);
    if (bqMatch) {
      elements.push(
        <Box key={`bq-${i}`} flexDirection="row">
          <Text color="gray" dimColor>{'  │ '}</Text>
          <InlineText text={bqMatch[1]} baseColor="gray" />
        </Box>,
      );
      i++; continue;
    }

    // ── Empty line ─────────────────────────────────────────────────────────
    if (!line.trim()) {
      elements.push(<Text key={`br-${i}`}>{''}</Text>);
      i++; continue;
    }

    // ── Regular paragraph line ─────────────────────────────────────────────
    elements.push(
      <Box key={`p-${i}`} flexDirection="row" flexWrap="wrap">
        <InlineText text={line} baseColor={baseColor} />
        {streaming && i === lines.length - 1 && (
          <Text color="gray"> ▌</Text>
        )}
      </Box>,
    );
    i++;
  }

  return <Box flexDirection="column">{elements}</Box>;
}
