/** 1차 지원 CLI. Antigravity 는 `agy` 명령을 사용한다. */
export type AiProviderId = 'codex' | 'claude' | 'antigravity';

export type AiProviderDefinition = {
    id: AiProviderId;
    displayName: string;
    command: string;
    description: string;
    installHint: string;
};

export type ProviderDetection = {
    id: AiProviderId;
    displayName: string;
    command: string;
    installed: boolean;
    executablePath?: string;
    error?: string;
};

export type AiWorkspaceFile = {
    path: string;
    content: string;
    encoding?: string;
    hash?: string;
};

export type AiWorkspaceSkippedFile = {
    path: string;
    reason: string;
};

/** GET /api/github/repos/workspace 의 data[0]. */
export type AiWorkspaceSnapshot = {
    repo_id: number;
    branch: string;
    head_sha?: string;
    file_count?: number;
    total_bytes?: number;
    truncated?: boolean;
    files: AiWorkspaceFile[];
    skipped?: AiWorkspaceSkippedFile[];
};

export type AiWorkspaceState = {
    repoId: number;
    branch: string;
    rootPath: string;
    headSha?: string;
    fileCount: number;
    skippedCount: number;
    preparedAt: number;
    message?: string;
};

export type AiBridgeConfig = {
    port: number;
    secret: string;
    sessionFile: string;
    mcpScript: string;
};

export type AiBridgeSessionFile = {
    version: 1;
    port: number;
    secret: string;
    repoId: number;
    branch: string;
    workspaceRoot: string;
    userEmail: string;
    sessionId: string;
};

export type AiViewState = {
    sessionRepoId?: number;
    sessionBranch?: string;
    workspace?: AiWorkspaceState;
    providers: ProviderDetection[];
    activeProvider?: AiProviderId;
    terminalOpen: boolean;
    bridgeRunning: boolean;
    message?: string;
};
