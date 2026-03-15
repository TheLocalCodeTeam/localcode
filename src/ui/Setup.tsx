// src/ui/Setup.tsx
// First-run onboarding wizard — shown when no saved session exists

import React, { useState } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { SessionState, Provider, PROVIDERS, DEFAULT_SYSTEM_PROMPT, DEFAULT_PERSONAS } from '../core/types.js';
import { saveSession } from '../sessions/manager.js';
import { exec } from 'child_process';

type Step =
  | 'welcome'
  | 'pick_provider'
  | 'check_ollama'
  | 'enter_key'
  | 'pick_model'
  | 'done';

interface SetupProps {
  onComplete: (session: SessionState) => void;
}

const PROVIDER_OPTIONS: Array<{ key: string; provider: Provider; label: string; desc: string }> = [
  { key: '1', provider: 'ollama', label: 'Ollama',  desc: 'Local models — free, no key needed' },
  { key: '2', provider: 'claude', label: 'Claude',  desc: 'Anthropic — best for coding' },
  { key: '3', provider: 'openai', label: 'OpenAI',  desc: 'GPT-4o and family' },
  { key: '4', provider: 'groq',   label: 'Groq',    desc: 'Fast inference, free tier' },
];

export function Setup({ onComplete }: SetupProps): React.ReactElement {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>('welcome');
  const [provider, setProvider] = useState<Provider>('ollama');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [keyInput, setKeyInput] = useState('');
  const [modelInput, setModelInput] = useState('');
  const [ollamaStatus, setOllamaStatus] = useState<'checking' | 'ok' | 'missing'>('checking');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);

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

  const finish = (finalProvider: Provider, finalKey: string, finalModel: string) => {
    const defaultModel = finalModel || PROVIDERS[finalProvider].defaultModel;
    const session: SessionState = {
      provider: finalProvider,
      model: defaultModel,
      messages: [],
      checkpoints: [],
      allowAllTools: false,
      workingDir: process.cwd(),
      apiKeys: finalKey ? { [finalProvider]: finalKey } as any : {},
      systemPrompt: DEFAULT_SYSTEM_PROMPT,
      personas: DEFAULT_PERSONAS,
      activePersona: 'pair-programmer',
      pinnedContext: [],
      autoCheckpoint: true,
      sessionCost: 0,
      lastAssistantMessage: '',
    };
    if (process.env.ANTHROPIC_API_KEY) session.apiKeys.claude = process.env.ANTHROPIC_API_KEY;
    if (process.env.OPENAI_API_KEY)    session.apiKeys.openai = process.env.OPENAI_API_KEY;
    if (process.env.GROQ_API_KEY)      session.apiKeys.groq   = process.env.GROQ_API_KEY;

    saveSession(session);
    onComplete(session);
  };

  useInput((input, key) => {
    if (step === 'welcome') {
      if (key.return || input === ' ') setStep('pick_provider');
      if (key.ctrl && input === 'c') exit();
      return;
    }

    if (step === 'pick_provider') {
      const opt = PROVIDER_OPTIONS.find((o) => o.key === input);
      if (opt) {
        setProvider(opt.provider);
        if (opt.provider === 'ollama') {
          checkOllama();
        } else {
          // Check for env key first
          const envKey =
            opt.provider === 'claude' ? process.env.ANTHROPIC_API_KEY :
            opt.provider === 'openai' ? process.env.OPENAI_API_KEY :
            opt.provider === 'groq'   ? process.env.GROQ_API_KEY : '';
          if (envKey) {
            setApiKey(envKey);
            setStep('done');
            setTimeout(() => finish(opt.provider, envKey, ''), 800);
          } else {
            setStep('enter_key');
          }
        }
      }
      if (key.ctrl && input === 'c') exit();
      return;
    }

    if (step === 'check_ollama') {
      if (ollamaStatus === 'ok' && key.return) {
        setStep('done');
        setTimeout(() => finish('ollama', '', ollamaModels[0] || 'qwen2.5-coder:7b'), 800);
      }
      if (key.ctrl && input === 'c') exit();
      return;
    }
  });

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box flexDirection="column" padding={1}>
      {/* Nyx welcome art */}
      <Box flexDirection="row" marginBottom={1}>
        <Box flexDirection="column" marginRight={2}>
          <Text color="yellowBright"> /\_/\ </Text>
          <Text color="yellowBright">{'( ·.· )'}</Text>
          <Text color="yellowBright"> {'> ♥ <'} </Text>
        </Box>
        <Box flexDirection="column" justifyContent="center">
          <Text bold color="yellowBright">LocalCode</Text>
          <Text color="gray" dimColor>v2.1 · @localcode/cli</Text>
          <Text color="gray" dimColor>by TheAlxLabs · co-piloted by Nyx</Text>
        </Box>
      </Box>

      <Box borderStyle="single" borderColor="gray" paddingX={2} paddingY={0} marginBottom={1}>

        {/* ── Welcome ── */}
        {step === 'welcome' && (
          <Box flexDirection="column">
            <Text color="white" bold>Welcome to LocalCode</Text>
            <Text color="gray" dimColor> </Text>
            <Text color="gray">A terminal coding assistant powered by AI.</Text>
            <Text color="gray">Works with Ollama locally, or Claude, OpenAI, and Groq via API.</Text>
            <Text color="gray" dimColor> </Text>
            <Text color="gray" dimColor>This setup only runs once. Your config is saved for next time.</Text>
            <Text color="gray" dimColor> </Text>
            <Text color="yellowBright">Press enter to get started →</Text>
          </Box>
        )}

        {/* ── Pick provider ── */}
        {step === 'pick_provider' && (
          <Box flexDirection="column">
            <Text color="white" bold>Choose a provider</Text>
            <Text color="gray" dimColor> </Text>
            {PROVIDER_OPTIONS.map((opt) => (
              <Box key={opt.key} flexDirection="row">
                <Text color="yellowBright">{opt.key}  </Text>
                <Box width={10}><Text color="cyan" bold>{opt.label}</Text></Box>
                <Text color="gray" dimColor>{opt.desc}</Text>
              </Box>
            ))}
            <Text color="gray" dimColor> </Text>
            <Text color="gray" dimColor>Press 1–4 to select</Text>
          </Box>
        )}

        {/* ── Ollama check ── */}
        {step === 'check_ollama' && (
          <Box flexDirection="column">
            <Text color="white" bold>Checking Ollama…</Text>
            <Text color="gray" dimColor> </Text>

            {ollamaStatus === 'checking' && (
              <Text color="gray">⟳  Scanning for Ollama install…</Text>
            )}

            {ollamaStatus === 'missing' && (
              <Box flexDirection="column">
                <Text color="red">✕  Ollama not found</Text>
                <Text color="gray" dimColor> </Text>
                <Text color="gray">Install it first:</Text>
                <Text color="cyan">  curl -fsSL https://ollama.com/install.sh | sh</Text>
                <Text color="cyan">  ollama pull qwen2.5-coder:7b</Text>
                <Text color="gray" dimColor> </Text>
                <Text color="gray" dimColor>Then re-run: localcode</Text>
              </Box>
            )}

            {ollamaStatus === 'ok' && (
              <Box flexDirection="column">
                <Text color="green">✓  Ollama is running</Text>
                {ollamaModels.length > 0 ? (
                  <>
                    <Text color="gray" dimColor> </Text>
                    <Text color="gray">Available models:</Text>
                    {ollamaModels.map((m) => (
                      <Text key={m} color="cyan">  · {m}</Text>
                    ))}
                    <Text color="gray" dimColor> </Text>
                    <Text color="yellowBright">↵  Continue with {ollamaModels[0]}</Text>
                  </>
                ) : (
                  <>
                    <Text color="yellow">  No models pulled yet</Text>
                    <Text color="gray" dimColor> </Text>
                    <Text color="gray">Pull a model first:</Text>
                    <Text color="cyan">  ollama pull qwen2.5-coder:7b</Text>
                  </>
                )}
              </Box>
            )}
          </Box>
        )}

        {/* ── Enter API key ── */}
        {step === 'enter_key' && (
          <Box flexDirection="column">
            <Text color="white" bold>Enter your {PROVIDERS[provider].displayName} API key</Text>
            <Text color="gray" dimColor> </Text>
            <Text color="gray" dimColor>
              {provider === 'claude' && 'Get one at: console.anthropic.com'}
              {provider === 'openai' && 'Get one at: platform.openai.com/api-keys'}
              {provider === 'groq'   && 'Get one at: console.groq.com/keys'}
            </Text>
            <Text color="gray" dimColor>Or set {
              provider === 'claude' ? 'ANTHROPIC_API_KEY' :
              provider === 'openai' ? 'OPENAI_API_KEY' : 'GROQ_API_KEY'
            } in your environment to skip this.</Text>
            <Text color="gray" dimColor> </Text>
            <Box flexDirection="row">
              <Text color="yellowBright">key  </Text>
              <TextInput
                value={keyInput}
                onChange={setKeyInput}
                onSubmit={(val) => {
                  if (val.trim()) {
                    setApiKey(val.trim());
                    setStep('done');
                    setTimeout(() => finish(provider, val.trim(), ''), 800);
                  }
                }}
                placeholder="sk-..."
                mask="*"
              />
            </Box>
          </Box>
        )}

        {/* ── Done ── */}
        {step === 'done' && (
          <Box flexDirection="column">
            <Text color="green" bold>✓  All set</Text>
            <Text color="gray" dimColor> </Text>
            <Text color="gray">Provider   <Text color="cyan">{PROVIDERS[provider].displayName}</Text></Text>
            <Text color="gray">Model      <Text color="cyan">{PROVIDERS[provider].defaultModel}</Text></Text>
            {apiKey && <Text color="gray">API key    <Text color="cyan">{apiKey.slice(0, 8)}…</Text></Text>}
            <Text color="gray" dimColor> </Text>
            <Text color="yellowBright">Launching…</Text>
          </Box>
        )}

      </Box>

      <Text color="gray" dimColor>  ctrl+c exit</Text>
    </Box>
  );
}
