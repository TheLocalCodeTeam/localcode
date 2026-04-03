// src/ui/Setup.tsx
// First-run onboarding wizard — shown when no saved session exists
import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { PROVIDERS, DEFAULT_SYSTEM_PROMPT, DEFAULT_PERSONAS } from '../types/index.js';
import { saveSession } from '../sessions/manager.js';
import { exec } from 'child_process';
const PROVIDER_OPTIONS = [
    { key: '1', provider: 'ollama', label: 'Ollama', desc: 'Local models — free, no key needed' },
    { key: '2', provider: 'claude', label: 'Claude', desc: 'Anthropic — best for coding' },
    { key: '3', provider: 'openai', label: 'OpenAI', desc: 'GPT-4o and family' },
    { key: '4', provider: 'groq', label: 'Groq', desc: 'Fast inference, free tier' },
];
export function Setup({ onComplete }) {
    const { exit } = useApp();
    const [step, setStep] = useState('welcome');
    const [provider, setProvider] = useState('ollama');
    const [apiKey, setApiKey] = useState('');
    const [model, setModel] = useState('');
    const [keyInput, setKeyInput] = useState('');
    const [modelInput, setModelInput] = useState('');
    const [ollamaStatus, setOllamaStatus] = useState('checking');
    const [ollamaModels, setOllamaModels] = useState([]);
    // Check Ollama when we land on that step
    const checkOllama = () => {
        setStep('check_ollama');
        setOllamaStatus('checking');
        exec('ollama list', (err, stdout) => {
            if (err) {
                setOllamaStatus('missing');
                return;
            }
            // Parse model names from `ollama list` output
            const lines = stdout.trim().split('\n').slice(1); // skip header
            const models = lines
                .map((l) => l.split(/\s+/)[0])
                .filter((m) => m && m !== 'NAME');
            setOllamaModels(models);
            setOllamaStatus('ok');
        });
    };
    const finish = (finalProvider, finalKey, finalModel) => {
        const defaultModel = finalModel || PROVIDERS[finalProvider].defaultModel;
        const session = {
            provider: finalProvider,
            model: defaultModel,
            messages: [],
            checkpoints: [],
            approvalMode: 'auto-edit',
            workingDir: process.cwd(),
            apiKeys: finalKey ? { [finalProvider]: finalKey } : {},
            systemPrompt: DEFAULT_SYSTEM_PROMPT,
            personas: DEFAULT_PERSONAS,
            activePersona: 'pair-programmer',
            pinnedContext: [],
            autoCheckpoint: true,
            maxSteps: 20,
            sessionCost: 0,
            lastAssistantMessage: '',
            theme: 'dark',
            modelRouting: null,
            budgetLimit: null,
            budgetFallbackModel: null,
            safeMode: false,
            autopilotActive: false,
            providerCallLog: [],
            dna: null,
        };
        if (process.env.ANTHROPIC_API_KEY)
            session.apiKeys.claude = process.env.ANTHROPIC_API_KEY;
        if (process.env.OPENAI_API_KEY)
            session.apiKeys.openai = process.env.OPENAI_API_KEY;
        if (process.env.GROQ_API_KEY)
            session.apiKeys.groq = process.env.GROQ_API_KEY;
        saveSession(session);
        onComplete(session);
    };
    useInput((input, key) => {
        if (step === 'welcome') {
            if (key.return || input === ' ')
                setStep('pick_provider');
            if (key.ctrl && input === 'c')
                exit();
            return;
        }
        if (step === 'pick_provider') {
            const opt = PROVIDER_OPTIONS.find((o) => o.key === input);
            if (opt) {
                setProvider(opt.provider);
                if (opt.provider === 'ollama') {
                    checkOllama();
                }
                else {
                    // Check for env key first
                    const envKey = opt.provider === 'claude' ? process.env.ANTHROPIC_API_KEY :
                        opt.provider === 'openai' ? process.env.OPENAI_API_KEY :
                            opt.provider === 'groq' ? process.env.GROQ_API_KEY : '';
                    if (envKey) {
                        setApiKey(envKey);
                        setStep('done');
                        setTimeout(() => finish(opt.provider, envKey, ''), 800);
                    }
                    else {
                        setStep('enter_key');
                    }
                }
            }
            if (key.ctrl && input === 'c')
                exit();
            return;
        }
        if (step === 'check_ollama') {
            if (ollamaStatus === 'ok' && key.return) {
                setStep('done');
                setTimeout(() => finish('ollama', '', ollamaModels[0] || 'qwen2.5-coder:7b'), 800);
            }
            if (key.ctrl && input === 'c')
                exit();
            return;
        }
    });
    // ── Render ────────────────────────────────────────────────────────────────
    return (React.createElement(Box, { flexDirection: "column", padding: 1 },
        React.createElement(Box, { flexDirection: "row", marginBottom: 1 },
            React.createElement(Box, { flexDirection: "column", marginRight: 2 },
                React.createElement(Text, { color: "yellowBright" }, " /\\_/\\ "),
                React.createElement(Text, { color: "yellowBright" }, '( ·.· )'),
                React.createElement(Text, { color: "yellowBright" },
                    " ",
                    '> ♥ <',
                    " ")),
            React.createElement(Box, { flexDirection: "column", justifyContent: "center" },
                React.createElement(Text, { bold: true, color: "yellowBright" }, "LocalCode"),
                React.createElement(Text, { color: "gray", dimColor: true }, "v3.1.0 \u00B7 @localcode/cli"),
                React.createElement(Text, { color: "gray", dimColor: true }, "by TheAlxLabs \u00B7 co-piloted by Nyx"))),
        React.createElement(Box, { borderStyle: "single", borderColor: "gray", paddingX: 2, paddingY: 0, marginBottom: 1 },
            step === 'welcome' && (React.createElement(Box, { flexDirection: "column" },
                React.createElement(Text, { color: "white", bold: true }, "Welcome to LocalCode"),
                React.createElement(Text, { color: "gray", dimColor: true }, " "),
                React.createElement(Text, { color: "gray" }, "A terminal coding assistant powered by AI."),
                React.createElement(Text, { color: "gray" }, "Works with Ollama locally, or Claude, OpenAI, and Groq via API."),
                React.createElement(Text, { color: "gray", dimColor: true }, " "),
                React.createElement(Text, { color: "gray", dimColor: true }, "This setup only runs once. Your config is saved for next time."),
                React.createElement(Text, { color: "gray", dimColor: true }, " "),
                React.createElement(Text, { color: "yellowBright" }, "Press enter to get started \u2192"))),
            step === 'pick_provider' && (React.createElement(Box, { flexDirection: "column" },
                React.createElement(Text, { color: "white", bold: true }, "Choose a provider"),
                React.createElement(Text, { color: "gray", dimColor: true }, " "),
                PROVIDER_OPTIONS.map((opt) => (React.createElement(Box, { key: opt.key, flexDirection: "row" },
                    React.createElement(Text, { color: "yellowBright" },
                        opt.key,
                        "  "),
                    React.createElement(Box, { width: 10 },
                        React.createElement(Text, { color: "cyan", bold: true }, opt.label)),
                    React.createElement(Text, { color: "gray", dimColor: true }, opt.desc)))),
                React.createElement(Text, { color: "gray", dimColor: true }, " "),
                React.createElement(Text, { color: "gray", dimColor: true }, "Press 1\u20134 to select"))),
            step === 'check_ollama' && (React.createElement(Box, { flexDirection: "column" },
                React.createElement(Text, { color: "white", bold: true }, "Checking Ollama\u2026"),
                React.createElement(Text, { color: "gray", dimColor: true }, " "),
                ollamaStatus === 'checking' && (React.createElement(Text, { color: "gray" }, "\u27F3  Scanning for Ollama install\u2026")),
                ollamaStatus === 'missing' && (React.createElement(Box, { flexDirection: "column" },
                    React.createElement(Text, { color: "red" }, "\u2715  Ollama not found"),
                    React.createElement(Text, { color: "gray", dimColor: true }, " "),
                    React.createElement(Text, { color: "gray" }, "Install it first:"),
                    React.createElement(Text, { color: "cyan" }, "  curl -fsSL https://ollama.com/install.sh | sh"),
                    React.createElement(Text, { color: "cyan" }, "  ollama pull qwen2.5-coder:7b"),
                    React.createElement(Text, { color: "gray", dimColor: true }, " "),
                    React.createElement(Text, { color: "gray", dimColor: true }, "Then re-run: localcode"))),
                ollamaStatus === 'ok' && (React.createElement(Box, { flexDirection: "column" },
                    React.createElement(Text, { color: "green" }, "\u2713  Ollama is running"),
                    ollamaModels.length > 0 ? (React.createElement(React.Fragment, null,
                        React.createElement(Text, { color: "gray", dimColor: true }, " "),
                        React.createElement(Text, { color: "gray" }, "Available models:"),
                        ollamaModels.map((m) => (React.createElement(Text, { key: m, color: "cyan" },
                            "  \u00B7 ",
                            m))),
                        React.createElement(Text, { color: "gray", dimColor: true }, " "),
                        React.createElement(Text, { color: "yellowBright" },
                            "\u21B5  Continue with ",
                            ollamaModels[0]))) : (React.createElement(React.Fragment, null,
                        React.createElement(Text, { color: "yellow" }, "  No models pulled yet"),
                        React.createElement(Text, { color: "gray", dimColor: true }, " "),
                        React.createElement(Text, { color: "gray" }, "Pull a model first:"),
                        React.createElement(Text, { color: "cyan" }, "  ollama pull qwen2.5-coder:7b"))))))),
            step === 'enter_key' && (React.createElement(Box, { flexDirection: "column" },
                React.createElement(Text, { color: "white", bold: true },
                    "Enter your ",
                    PROVIDERS[provider].displayName,
                    " API key"),
                React.createElement(Text, { color: "gray", dimColor: true }, " "),
                React.createElement(Text, { color: "gray", dimColor: true },
                    provider === 'claude' && 'Get one at: console.anthropic.com',
                    provider === 'openai' && 'Get one at: platform.openai.com/api-keys',
                    provider === 'groq' && 'Get one at: console.groq.com/keys'),
                React.createElement(Text, { color: "gray", dimColor: true },
                    "Or set ",
                    provider === 'claude' ? 'ANTHROPIC_API_KEY' :
                        provider === 'openai' ? 'OPENAI_API_KEY' : 'GROQ_API_KEY',
                    " in your environment to skip this."),
                React.createElement(Text, { color: "gray", dimColor: true }, " "),
                React.createElement(Box, { flexDirection: "row" },
                    React.createElement(Text, { color: "yellowBright" }, "key  "),
                    React.createElement(TextInput, { value: keyInput, onChange: setKeyInput, onSubmit: (val) => {
                            if (val.trim()) {
                                setApiKey(val.trim());
                                setStep('done');
                                setTimeout(() => finish(provider, val.trim(), ''), 800);
                            }
                        }, placeholder: "sk-...", mask: "*" })))),
            step === 'done' && (React.createElement(Box, { flexDirection: "column" },
                React.createElement(Text, { color: "green", bold: true }, "\u2713  All set"),
                React.createElement(Text, { color: "gray", dimColor: true }, " "),
                React.createElement(Text, { color: "gray" },
                    "Provider   ",
                    React.createElement(Text, { color: "cyan" }, PROVIDERS[provider].displayName)),
                React.createElement(Text, { color: "gray" },
                    "Model      ",
                    React.createElement(Text, { color: "cyan" }, PROVIDERS[provider].defaultModel)),
                apiKey && React.createElement(Text, { color: "gray" },
                    "API key    ",
                    React.createElement(Text, { color: "cyan" },
                        apiKey.slice(0, 8),
                        "\u2026")),
                React.createElement(Text, { color: "gray", dimColor: true }, " "),
                React.createElement(Text, { color: "yellowBright" }, "Launching\u2026")))),
        React.createElement(Text, { color: "gray", dimColor: true }, "  ctrl+c exit")));
}
//# sourceMappingURL=Setup.js.map