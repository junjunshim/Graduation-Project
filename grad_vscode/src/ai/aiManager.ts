import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { apiRequest } from '../api';
import { getCurrentBranch, getSession, onDidChangeSession } from '../repo/repoSession';
import {
    getControlState,
    onDidChangeControlState,
    onDidReceiveControlEvent,
    type ControlEvent,
    type ControlState
} from '../repo/controlSocket';
import { AiFileWriteBridge } from './fileWriteBridge';
import { AiMcpBridgeServer } from './mcpBridgeServer';
import { agyMcpConfigPath, writeMcpConfigs } from './mcpConfig';
import { detectProviders, detectionFor } from './providerDetector';
import { AI_PROVIDERS, getProvider } from './providerRegistry';
import { AiTerminalManager } from './terminalManager';
import type { AiProviderId, AiViewState, AiWorkspaceState, ProviderDetection } from './types';
import {
    AiWorkspaceManager,
    isSensitiveAiWorkspacePath,
    isSafeAiWorkspacePath
} from './workspaceManager';
import { AiWorkspaceWatcher } from './workspaceWatcher';

type FileRow = {
    content?: unknown;
    content_hash?: unknown;
    changed?: unknown;
    read_only?: unknown;
    reason?: unknown;
    content_omitted?: unknown;
};

function requireSession(): { repoId: number; branch: string; userEmail: string } {
    const session = getSession();
    const branch = getCurrentBranch();
    if (!session || !branch) {
        throw new Error('Axis 세션이 없습니다. 앱에서 저장소를 다시 열어 주세요.');
    }
    return { repoId: session.repoId, branch, userEmail: session.userEmail };
}

function stringArg(args: Record<string, unknown>, key: string, required = false): string | undefined {
    const value = args[key];
    if (typeof value !== 'string') {
        if (required) {
            throw new Error(`${key} 문자열이 필요합니다.`);
        }
        return undefined;
    }
    return value;
}

/** 설정한 실행 파일 경로에 공백이 있어도 터미널이 한 명령으로 읽도록 감싼다. */
function launchCommandFor(provider: ProviderDetection): string {
    const executable = provider.executablePath ?? provider.command;
    return /[\s"]/u.test(executable) ? `"${executable.replace(/"/g, '\"')}"` : executable;
}

export class AiManager {
    private readonly workspace: AiWorkspaceManager;
    private readonly terminal = new AiTerminalManager();
    private readonly writeBridge: AiFileWriteBridge;
    private readonly bridge: AiMcpBridgeServer;
    private readonly watcher = new AiWorkspaceWatcher((paths) => {
        void this.handleLocalChanges(paths);
    });
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    private readonly disposables: vscode.Disposable[] = [];
    private readonly mcpScript: string;

    private providers: ProviderDetection[] = [];
    private activeProvider: AiProviderId | undefined;
    private lastSessionKey: string | undefined;
    private sessionIdentityKey: string | undefined;
    private syncMessage: string | undefined;
    private syncQueue: Promise<void> = Promise.resolve();
    private lastControlState: ControlState = 'disconnected';
    private serverSyncTimer: ReturnType<typeof setTimeout> | undefined;
    private readonly pendingServerPaths = new Set<string>();
    private readonly pendingServerDeletes = new Set<string>();

    public readonly onDidChange = this.changeEmitter.event;

    public constructor(context: vscode.ExtensionContext) {
        this.workspace = new AiWorkspaceManager(context);
        this.writeBridge = new AiFileWriteBridge(this.workspace);
        this.bridge = new AiMcpBridgeServer(context, (name, args) => this.handleTool(name, args));
        this.mcpScript = path.join(context.extensionUri.fsPath, 'dist', 'mcp', 'axis-share-mcp.js');

        this.disposables.push(
            onDidChangeSession(() => {
                void this.handleSessionChanged();
            })
        );
        this.lastControlState = getControlState();
        this.disposables.push(
            onDidReceiveControlEvent((event) => this.handleControlEvent(event)),
            onDidChangeControlState((next) => this.handleControlState(next))
        );
        this.disposables.push(
            vscode.workspace.onDidChangeConfiguration((event) => {
                if (event.affectsConfiguration('axis-share.ai')) {
                    void this.refreshProviders();
                }
            })
        );
    }

    public async initialize(): Promise<void> {
        await this.refreshProviders();
        this.lastSessionKey = this.currentSessionKey();
    }

    public getViewState(): AiViewState {
        const session = getSession();
        const branch = getCurrentBranch();
        return {
            sessionRepoId: session?.repoId,
            sessionBranch: branch,
            workspace: this.workspace.getState(),
            providers: this.providers,
            activeProvider: this.activeProvider,
            terminalOpen: this.terminal.isOpen(),
            bridgeRunning: this.bridge.isRunning(),
            message: this.aiEnabled() ? this.syncMessage : 'AI 기능이 설정에서 비활성화되어 있습니다.'
        };
    }

    public async refreshProviders(): Promise<void> {
        if (!this.aiEnabled()) {
            this.providers = [];
            this.changeEmitter.fire();
            return;
        }

        try {
            this.providers = await detectProviders();
        } catch (error) {
            this.providers = AI_PROVIDERS.map((provider) => ({
                id: provider.id,
                displayName: provider.displayName,
                command: provider.command,
                installed: false,
                error: error instanceof Error ? error.message : String(error)
            }));
        }
        this.changeEmitter.fire();
    }

    public async openTerminal(providerId?: AiProviderId): Promise<void> {
        if (!this.aiEnabled()) {
            void vscode.window.showWarningMessage('Axis Share: AI 기능이 설정에서 비활성화되어 있습니다.');
            return;
        }

        const provider = this.resolveProvider(providerId);
        const definition = getProvider(provider.id);
        const workspace = this.aiAutoSync() ? await this.prepareWorkspace() : await this.ensureWorkspace();
        await this.refreshMcpConfigs(workspace);
        this.terminal.open(workspace.rootPath, definition, workspace.repoId, workspace.branch);
        this.activeProvider = provider.id;
        this.changeEmitter.fire();
    }

    public async launchProvider(providerId?: AiProviderId): Promise<void> {
        if (!this.aiEnabled()) {
            void vscode.window.showWarningMessage('Axis Share: AI 기능이 설정에서 비활성화되어 있습니다.');
            return;
        }

        const selected = providerId ?? this.activeProvider;
        const provider = this.resolveProvider(selected);
        if (!provider.installed) {
            const definition = getProvider(provider.id);
            const choice = await vscode.window.showWarningMessage(
                `Axis Share: ${provider.displayName} CLI를 찾지 못했습니다. ${provider.error ?? definition.installHint}`,
                '설정 열기'
            );
            if (choice === '설정 열기') {
                await vscode.commands.executeCommand('workbench.action.openSettings', 'axis-share.ai.providers');
            }
            return;
        }

        const definition = getProvider(provider.id);
        const workspace = this.aiAutoSync() ? await this.prepareWorkspace() : await this.ensureWorkspace();
        await this.refreshMcpConfigs(workspace);
        this.terminal.open(
            workspace.rootPath,
            definition,
            workspace.repoId,
            workspace.branch,
            launchCommandFor(provider)
        );
        this.activeProvider = provider.id;
        this.changeEmitter.fire();
    }

    public async syncWorkspace(): Promise<void> {
        const workspace = await this.prepareWorkspace();
        void vscode.window.showInformationMessage(
            `Axis Share: AI 작업공간을 동기화했습니다. (${workspace.fileCount}개 파일)`
        );
    }

    public async resetWorkspace(): Promise<void> {
        const choice = await vscode.window.showWarningMessage(
            'Axis Share: AI 작업공간을 삭제할까요? 커밋하지 않은 AI 작업 내용도 함께 사라집니다.',
            { modal: true },
            '삭제'
        );
        if (choice !== '삭제') {
            return;
        }

        this.terminal.disposeAll();
        this.watcher.stop();
        this.cancelServerSync();
        await this.bridge.stop().catch(() => undefined);
        await this.workspace.reset();
        this.activeProvider = undefined;
        this.sessionIdentityKey = undefined;
        this.syncMessage = undefined;
        this.changeEmitter.fire();
        void vscode.window.showInformationMessage('Axis Share: AI 작업공간을 초기화했습니다.');
    }

    public async configureMcp(): Promise<void> {
        const workspace = await this.ensureWorkspace();
        await this.refreshMcpConfigs(workspace);
        const configPath = this.activeProvider === 'antigravity'
            ? agyMcpConfigPath()
            : path.join(workspace.rootPath, '.axis', 'mcp.json');
        const uri = vscode.Uri.file(configPath);
        await vscode.window.showTextDocument(uri, { preview: true });
        const config = this.bridge.getConfig();
        if (config) {
            void vscode.window.showInformationMessage(
                `Axis Share: MCP 브리지가 127.0.0.1:${config.port} 에서 실행 중입니다.`
            );
        }
    }

    public async stopSession(): Promise<void> {
        this.terminal.disposeAll();
        this.watcher.stop();
        this.cancelServerSync();
        await this.bridge.stop();
        this.workspace.clearState();
        this.activeProvider = undefined;
        this.sessionIdentityKey = undefined;
        this.syncMessage = undefined;
        this.changeEmitter.fire();
        void vscode.window.showInformationMessage('Axis Share: AI 세션과 MCP 브리지를 종료했습니다.');
    }

    public async dispose(): Promise<void> {
        this.terminal.dispose();
        this.watcher.dispose();
        this.cancelServerSync();
        await this.bridge.stop().catch(() => undefined);
        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.changeEmitter.dispose();
    }

    private aiEnabled(): boolean {
        return vscode.workspace.getConfiguration('axis-share').get<boolean>('ai.enabled', true);
    }

    private aiAutoSync(): boolean {
        return vscode.workspace.getConfiguration('axis-share').get<boolean>('ai.autoSync', false);
    }

    private aiLiveSync(): boolean {
        return vscode.workspace.getConfiguration('axis-share').get<boolean>('ai.liveSync', true);
    }

    private aiWritesAllowed(): boolean {
        return vscode.workspace.getConfiguration('axis-share').get<boolean>('ai.allowWrite', true);
    }

    private resolveProvider(providerId?: AiProviderId): ProviderDetection {
        const id = providerId ?? this.activeProvider ?? this.providers.find((item) => item.installed)?.id ?? 'codex';
        const existing = detectionFor(this.providers, id);
        if (existing) {
            return existing;
        }
        const definition = getProvider(id);
        return {
            id,
            displayName: definition.displayName,
            command: definition.command,
            installed: false,
            error: 'CLI 설치 상태를 아직 확인하지 못했습니다.'
        };
    }

    private currentSessionKey(): string | undefined {
        const session = getSession();
        const branch = getCurrentBranch();
        return session && branch ? `${session.repoId}|${branch}` : undefined;
    }

    private async handleSessionChanged(): Promise<void> {
        const nextKey = this.currentSessionKey();
        if (nextKey === this.lastSessionKey) {
            return;
        }

        this.lastSessionKey = nextKey;
        this.terminal.disposeAll();
        this.watcher.stop();
        this.cancelServerSync();
        this.workspace.clearState();
        this.activeProvider = undefined;
        this.sessionIdentityKey = undefined;
        this.syncMessage = undefined;
        await this.bridge.stop().catch(() => undefined);
        this.changeEmitter.fire();
    }

    /**
     * 제어 WebSocket 이 알려 준 변경만 AI 작업공간에 반영한다.
     * 변경이 잦으면 400ms 모아서 한 번에 처리하고, 로컬 변경 동기화와 같은 큐를 쓴다.
     */
    private handleControlEvent(event: ControlEvent): void {
        if (!this.aiLiveSync() || !this.workspace.getState()) {
            return;
        }

        const session = getSession();
        const branch = getCurrentBranch();
        if (!session || !branch || event.repoId !== session.repoId || event.branch !== branch) {
            return;
        }

        switch (event.type) {
            case 'worktree_changed':
                for (const path of event.paths ?? []) {
                    this.queueServerPath(path);
                }
                break;
            case 'file_created':
            case 'file_restored':
                this.queueServerPath(event.path);
                break;
            case 'file_deleted':
                this.queueServerDelete(event.path);
                break;
            case 'file_moved':
                this.queueServerDelete(event.from);
                this.queueServerPath(event.path);
                break;
            default:
                return;
        }

        if (this.pendingServerPaths.size === 0 && this.pendingServerDeletes.size === 0) {
            return;
        }
        if (this.serverSyncTimer) {
            clearTimeout(this.serverSyncTimer);
        }
        this.serverSyncTimer = setTimeout(() => {
            this.serverSyncTimer = undefined;
            this.flushServerChanges();
        }, 400);
    }

    /** 연결이 끊겼다 돌아오면 놓친 변경을 manifest 차이로 한 번 맞춘다. */
    private handleControlState(next: ControlState): void {
        const previous = this.lastControlState;
        this.lastControlState = next;
        if (next !== 'joined' || previous === 'joined' || !this.aiLiveSync()) {
            return;
        }
        if (!this.workspace.getState()) {
            return;
        }

        const run = this.syncQueue.then(async () => {
            try {
                await this.workspace.resync();
                this.changeEmitter.fire();
            } catch {
                // 연결 직후 서버가 아직 준비되지 않았을 수 있다. 다음 변경 알림에서 다시 맞춘다.
            }
        });
        this.syncQueue = run.catch(() => undefined);
    }

    private queueServerPath(value: string | undefined): void {
        if (!value || !isSafeAiWorkspacePath(value) || isSensitiveAiWorkspacePath(value)) {
            return;
        }
        this.pendingServerDeletes.delete(value);
        this.pendingServerPaths.add(value);
    }

    private queueServerDelete(value: string | undefined): void {
        if (!value || !isSafeAiWorkspacePath(value) || isSensitiveAiWorkspacePath(value)) {
            return;
        }
        this.pendingServerPaths.delete(value);
        this.pendingServerDeletes.add(value);
    }

    private cancelServerSync(): void {
        if (this.serverSyncTimer) {
            clearTimeout(this.serverSyncTimer);
            this.serverSyncTimer = undefined;
        }
        this.pendingServerPaths.clear();
        this.pendingServerDeletes.clear();
    }

    private flushServerChanges(): void {
        if (this.pendingServerPaths.size === 0 && this.pendingServerDeletes.size === 0) {
            return;
        }

        const paths = [...this.pendingServerPaths];
        const deletes = [...this.pendingServerDeletes];
        this.pendingServerPaths.clear();
        this.pendingServerDeletes.clear();

        const run = this.syncQueue.then(() => this.processServerChanges(paths, deletes));
        this.syncQueue = run.catch(() => undefined);
    }

    private async processServerChanges(paths: readonly string[], deletes: readonly string[]): Promise<void> {
        if (!this.workspace.getState()) {
            return;
        }

        const result = await this.workspace.applyServerChanges({ paths, deletes });
        if (result.conflicts > 0) {
            this.syncMessage =
                `다른 사용자가 바꾼 파일 ${result.conflicts}개는 AI 작업 중이라 덮어쓰지 않았습니다. ` +
                '충돌을 정리한 뒤 다시 동기화해 주세요.';
            this.changeEmitter.fire();
            return;
        }
        if (result.written > 0 || result.deleted > 0) {
            if (this.syncMessage) {
                this.syncMessage = undefined;
            }
            this.changeEmitter.fire();
        }
    }

    private async prepareWorkspace(): Promise<NonNullable<AiViewState['workspace']>> {
        this.watcher.stop();
        this.cancelServerSync();
        // 로컬 변경 업로드·서버 변경 반영과 같은 큐에서 실행해 baseline 이 서로 엇갈리지 않게 한다.
        const run = this.syncQueue.then(() => this.doPrepareWorkspace());
        this.syncQueue = run.then(
            () => undefined,
            () => undefined
        );
        return run;
    }

    private async doPrepareWorkspace(): Promise<NonNullable<AiViewState['workspace']>> {
        const session = requireSession();
        try {
            await fs.access(this.mcpScript);
        } catch {
            throw new Error('AI MCP 서버 번들을 찾지 못했습니다. 확장을 다시 빌드한 뒤 재시도해 주세요.');
        }
        const root = this.workspace.getRootPathFor(session.repoId, session.branch);
        const identityKey = `${session.repoId}|${session.branch}|${root}`;
        if (this.sessionIdentityKey !== identityKey) {
            await this.bridge.updateIdentity({
                repoId: session.repoId,
                branch: session.branch,
                workspaceRoot: root,
                userEmail: session.userEmail
            });
            this.sessionIdentityKey = identityKey;
        }

        const config = await this.bridge.start(
            {
                repoId: session.repoId,
                branch: session.branch,
                workspaceRoot: root,
                userEmail: session.userEmail
            },
            this.mcpScript
        );
        const state = await this.workspace.prepare(config);
        this.watcher.start(state.rootPath);
        this.changeEmitter.fire();
        return state;
    }

    private async handleTool(name: string, args: Record<string, unknown>): Promise<unknown> {
        const session = requireSession();

        switch (name) {
            case 'axis_get_context': {
                await this.ensureWorkspace();
                return { text: await this.workspace.refreshContext() };
            }
            case 'axis_list_files': {
                await this.ensureWorkspace();
                const files = await this.workspace.listFiles();
                return { workspace: this.workspace.getState()?.rootPath, count: files.length, files };
            }
            case 'axis_read_file': {
                const filePath = stringArg(args, 'path', true) ?? '';
                if (!isSafeAiWorkspacePath(filePath) || isSensitiveAiWorkspacePath(filePath)) {
                    throw new Error(`읽을 수 없는 경로입니다: ${filePath}`);
                }
                const since = stringArg(args, 'since');
                const rows = await apiRequest<FileRow[]>(
                    `/github/repos/file?repo_id=${session.repoId}` +
                        `&branch=${encodeURIComponent(session.branch)}` +
                        `&path=${encodeURIComponent(filePath)}&ref=worktree` +
                        (since ? `&since=${encodeURIComponent(since)}` : '')
                );
                const row = Array.isArray(rows) ? rows[0] : undefined;
                if (!row) {
                    throw new Error(`파일을 찾을 수 없습니다: ${filePath}`);
                }
                if (row.content_omitted === true) {
                    return { path: filePath, omitted: true, reason: row.reason ?? 'unavailable' };
                }
                if (row.changed === false) {
                    return {
                        path: filePath,
                        content_hash: row.content_hash,
                        changed: false,
                        note: 'Content is unchanged since the supplied hash.'
                    };
                }
                if (typeof row.content === 'string' && this.workspace.getState()) {
                    // AI 가 MCP 로 최신 내용을 읽으면 작업공간 사본도 맞춰, 이어지는 디스크 편집이
                    // 옛 baseline 때문에 불필요한 CAS 충돌을 내지 않게 한다.
                    await this.workspace.adoptServerFile(
                        filePath,
                        row.content,
                        typeof row.content_hash === 'string' ? row.content_hash : undefined
                    );
                }
                return {
                    path: filePath,
                    content: typeof row.content === 'string' ? row.content : '',
                    content_hash: row.content_hash,
                    changed: row.changed !== false
                };
            }
            case 'axis_get_status': {
                const rows = await apiRequest<unknown[]>(
                    `/github/repos/status?repo_id=${session.repoId}&branch=${encodeURIComponent(session.branch)}`
                );
                return { status: Array.isArray(rows) ? rows : [] };
            }
            case 'axis_get_diff': {
                const mode = stringArg(args, 'mode') === 'staged' ? 'staged' : 'working';
                const filePath = stringArg(args, 'path');
                if (filePath && (!isSafeAiWorkspacePath(filePath) || isSensitiveAiWorkspacePath(filePath))) {
                    throw new Error(`diff 를 볼 수 없는 경로입니다: ${filePath}`);
                }
                const rows = await apiRequest<unknown[]>(
                    `/github/repos/patch?repo_id=${session.repoId}` +
                        `&branch=${encodeURIComponent(session.branch)}&mode=${mode}` +
                        (filePath ? `&path=${encodeURIComponent(filePath)}` : '')
                );
                return Array.isArray(rows) ? rows[0] ?? { patch: '', truncated: false } : { patch: '', truncated: false };
            }
            case 'axis_get_presence': {
                return apiRequest<unknown[]>(`/github/repos/presence?repo_id=${session.repoId}`);
            }
            case 'axis_write_file': {
                if (!this.aiWritesAllowed()) {
                    throw new Error('AI 파일 쓰기가 Axis 설정에서 비활성화되어 있습니다.');
                }
                await this.ensureWorkspace();
                return this.writeBridge.write(args);
            }
            case 'axis_delete_file': {
                if (!this.aiWritesAllowed()) {
                    throw new Error('AI 파일 쓰기가 Axis 설정에서 비활성화되어 있습니다.');
                }
                await this.ensureWorkspace();
                return this.writeBridge.remove(args);
            }
            case 'axis_stage': {
                if (!this.aiWritesAllowed()) {
                    throw new Error('AI 파일 쓰기가 Axis 설정에서 비활성화되어 있습니다.');
                }
                return this.writeBridge.setStaged(args, true);
            }
            case 'axis_unstage': {
                if (!this.aiWritesAllowed()) {
                    throw new Error('AI 파일 쓰기가 Axis 설정에서 비활성화되어 있습니다.');
                }
                return this.writeBridge.setStaged(args, false);
            }
            default:
                throw new Error(`지원하지 않는 MCP 도구입니다: ${name}`);
        }
    }

    private async handleLocalChanges(paths: readonly string[]): Promise<void> {
        // 서버 쓰기는 저장소 단위로 직렬화된다. 같은 파일의 두 배치가 동시에 들어가면
        // 둘 다 옛 baseline 을 읽어 한쪽이 불필요한 CAS 충돌을 내므로 여기서도 순서를 지킨다.
        const run = this.syncQueue.then(() => this.processLocalChanges(paths));
        this.syncQueue = run.catch(() => undefined);
        return this.syncQueue;
    }

    private async processLocalChanges(paths: readonly string[]): Promise<void> {
        if (!this.workspace.getState()) {
            return;
        }

        const failures: string[] = [];
        for (const path of paths) {
            try {
                await this.syncLocalPath(path);
            } catch (error) {
                failures.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }

        if (failures.length > 0) {
            const summary = failures.slice(0, 2).join(' / ');
            this.syncMessage = `AI 변경을 서버에 반영하지 못했습니다. ${summary}`;
            this.changeEmitter.fire();
            void vscode.window.showWarningMessage(
                `Axis Share: 다른 사용자가 먼저 수정했거나 파일이 너무 큽니다. ${summary}`
            );
            return;
        }

        if (this.syncMessage) {
            this.syncMessage = undefined;
            this.changeEmitter.fire();
        }
    }

    /**
     * 디스크에서 바뀐 파일 하나를 서버에 CAS 로 반영한다.
     * 로컬 해시가 baseline 과 같으면 확장이 쓴 파일이므로 아무 것도 하지 않는다.
     */
    private async syncLocalPath(relPath: string): Promise<void> {
        const state = await this.workspace.readSyncState(relPath);
        if (state.skipReason) {
            return;
        }

        if (state.content !== undefined && state.currentHash !== undefined) {
            if (state.currentHash === state.baselineHash) {
                return;
            }
            await this.writeBridge.write({
                path: relPath,
                content: state.content,
                expected_hash: state.baselineHash ?? ''
            });
            this.changeEmitter.fire();
            return;
        }

        if (state.baselineHash) {
            await this.writeBridge.remove({ path: relPath, expected_hash: state.baselineHash });
            this.changeEmitter.fire();
        }
    }

    private async ensureWorkspace(): Promise<AiWorkspaceState> {
        const current = this.workspace.getState();
        const session = requireSession();
        if (current && current.repoId === session.repoId && current.branch === session.branch) {
            if (this.bridge.isRunning()) {
                this.watcher.start(current.rootPath);
                return current;
            }
        }
        return this.prepareWorkspace();
    }

    private async refreshMcpConfigs(workspace: AiWorkspaceState): Promise<void> {
        const config = this.bridge.getConfig();
        if (!config) {
            return;
        }

        try {
            const warnings = await writeMcpConfigs(workspace.rootPath, config.mcpScript, config.sessionFile);
            if (warnings.length > 0) {
                this.syncMessage = warnings.join(' ');
                this.changeEmitter.fire();
                void vscode.window.showWarningMessage(`Axis Share: ${this.syncMessage}`);
            }
        } catch (error) {
            this.syncMessage = `MCP 설정을 갱신하지 못했습니다: ${
                error instanceof Error ? error.message : String(error)
            }`;
            this.changeEmitter.fire();
            void vscode.window.showWarningMessage(`Axis Share: ${this.syncMessage}`);
        }
    }
}
