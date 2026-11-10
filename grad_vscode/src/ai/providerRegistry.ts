import type { AiProviderDefinition, AiProviderId } from './types';

export const AI_PROVIDERS: readonly AiProviderDefinition[] = [
    {
        id: 'codex',
        displayName: 'Codex',
        command: 'codex',
        description: 'OpenAI Codex CLI. ChatGPT 로그인 또는 API 키를 CLI 자체에서 사용합니다.',
        installHint: 'Codex CLI 설치 후 `codex` 명령이 PATH 에 있는지 확인해 주세요.'
    },
    {
        id: 'claude',
        displayName: 'Claude',
        command: 'claude',
        description: 'Claude Code CLI. Anthropic 계정 로그인을 CLI 자체에서 사용합니다.',
        installHint: 'Claude Code 설치 후 `claude` 명령이 PATH 에 있는지 확인해 주세요.'
    },
    {
        id: 'antigravity',
        displayName: 'Antigravity',
        command: 'agy',
        description: 'Antigravity CLI. 현재 2차 지원 대상이며 명령 이름은 `agy` 입니다.',
        installHint: 'Antigravity CLI 설치 후 `agy` 명령이 PATH 에 있는지 확인해 주세요.'
    }
];

export function getProvider(id: AiProviderId): AiProviderDefinition {
    const provider = AI_PROVIDERS.find((item) => item.id === id);
    if (!provider) {
        throw new Error(`알 수 없는 AI 제공자입니다: ${id}`);
    }
    return provider;
}

export function isAiProviderId(value: unknown): value is AiProviderId {
    return value === 'codex' || value === 'claude' || value === 'antigravity';
}

export function providerPathSetting(id: AiProviderId): string {
    return `ai.providers.${id}.path`;
}
