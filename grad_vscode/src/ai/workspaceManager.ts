import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { TextDecoder } from 'node:util';

import * as vscode from 'vscode';

import { ApiError, apiRequest } from '../api';
import { getCurrentBranch, getSession } from '../repo/repoSession';
import { branchSlug } from '../repo/repoTreeProvider';
import { buildContextMarkdown } from './contextBuilder';
import { writeMcpConfigs } from './mcpConfig';
import type {
    AiBridgeConfig,
    AiWorkspaceManifest,
    AiWorkspaceManifestEntry,
    AiWorkspaceSnapshot,
    AiWorkspaceState
} from './types';

type WorkspaceBaseline = {
    version: 1;
    files: Record<string, string>;
};

/** `.axis/manifest.json` — 마지막으로 맞춘 서버 파일의 버전 토큰. */
type WorkspaceManifestCache = {
    version: 1;
    files: Record<string, { size: number; version: string }>;
};

type ApplyResult = {
    baseline: WorkspaceBaseline;
    manifest: WorkspaceManifestCache;
    localSkipped: number;
    deleted: number;
    written: number;
    changedPaths: string[];
};

type ServerApplyResult = {
    written: number;
    deleted: number;
    conflicts: number;
};

type DownloadResult =
    | { kind: 'content'; content: string; hash?: string; version?: string }
    | { kind: 'omitted'; version?: string }
    | { kind: 'missing' }
    | { kind: 'error' };

const MAX_LOCAL_FILE_BYTES = 4 * 1024 * 1024;
// 서버의 AI 쓰기 상한과 같다. 이보다 큰 파일은 자동 동기화 대신 사용자에게 경고한다.
const MAX_SYNC_FILE_BYTES = 512 * 1024;

// 최초 동기화는 파일별 요청을 병렬로 내린다. 서버가 24MB JSON 하나를 만들지 않도록
// manifest 로 바뀐 파일만 골라 받고, 동시에 6개까지만 읽어 메모리 사용을 제한한다.
const MAX_DOWNLOAD_CONCURRENCY = 6;

const MANAGED_MCP_CONFIG_PATHS = ['.mcp.json', '.codex/config.toml', '.antigravity/mcp.json'] as const;

function hashContent(content: string): string {
    return `sha256:${createHash('sha256').update(content, 'utf8').digest('hex')}`;
}

export function isSafeAiWorkspacePath(value: string): boolean {
    if (value.length === 0 || value.length > 4096 || value.startsWith('/') || value.startsWith('~')) {
        return false;
    }
    if (value.includes('\\') || value.includes('\0')) {
        return false;
    }

    return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..' && segment !== '.git');
}

export function isSensitiveAiWorkspacePath(value: string): boolean {
    const lower = value.toLowerCase();
    const name = lower.split('/').pop() ?? lower;
    if (name === '.env' || (name.startsWith('.env.') && name !== '.env.example')) {
        return true;
    }
    if (['.npmrc', '.pypirc', '.netrc', '.git-credentials', 'credentials.json', 'id_rsa', 'id_ed25519'].includes(name)) {
        return true;
    }
    return lower === '.ssh' || lower.startsWith('.ssh/') || lower.includes('/.ssh/');
}

/** AI 작업공간 감시·동기화에서 제외할 경로. `.git`·확장이 만든 설정·민감 파일이 여기에 해당한다. */
export function shouldIgnoreAiWorkspacePath(value: string): boolean {
    if (value.length === 0) {
        return true;
    }

    const lower = value.toLowerCase();
    if (lower === '.mcp.json' || lower === '.ds_store' || lower === 'thumbs.db') {
        return true;
    }

    const first = lower.split('/')[0];
    if (
        first === '.git' ||
        first === '.axis' ||
        first === '.codex' ||
        first === '.antigravity' ||
        first === 'node_modules' ||
        first === '.worktrees'
    ) {
        return true;
    }

    return isSensitiveAiWorkspacePath(value);
}

function localPath(root: string, relPath: string): string {
    if (!isSafeAiWorkspacePath(relPath)) {
        throw new Error(`안전하지 않은 경로입니다: ${relPath}`);
    }
    const resolved = path.resolve(root, ...relPath.split('/'));
    const relative = path.relative(root, resolved);
    if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`작업공간 밖 경로입니다: ${relPath}`);
    }
    return resolved;
}

async function readFileIfPresent(file: string): Promise<string | undefined> {
    try {
        const stat = await fs.lstat(file);
        if (stat.isSymbolicLink() || !stat.isFile() || stat.size > MAX_LOCAL_FILE_BYTES) {
            return undefined;
        }
        return await fs.readFile(file, 'utf8');
    } catch {
        return undefined;
    }
}

async function writeFileAtomic(file: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const suffix = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const temp = `${file}.${suffix}.tmp`;
    await fs.writeFile(temp, content, 'utf8');
    await fs.rename(temp, file);
}

function runGit(cwd: string, args: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
        execFile('git', args, { cwd, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, _stdout, stderr) => {
            if (error) {
                reject(new Error(stderr.trim() || error.message));
                return;
            }
            resolve();
        });
    });
}

/** 인덱스에 올라간 변경이 있는가. AI 의 unstaged 수정과 구분하려고 `git diff --cached` 를 쓴다. */
function hasStagedChanges(cwd: string): Promise<boolean> {
    return new Promise((resolve) => {
        execFile('git', ['diff', '--cached', '--quiet'], { cwd, windowsHide: true }, (error) => {
            if (!error) {
                resolve(false);
                return;
            }
            resolve(typeof error.code === 'number' && error.code === 1);
        });
    });
}

async function pathExists(file: string): Promise<boolean> {
    try {
        await fs.access(file);
        return true;
    } catch {
        return false;
    }
}

/** 파일별 다운로드를 제한된 동시성으로 실행한다. 결과 배열은 입력 순서를 유지한다. */
async function mapWithConcurrency<T, R>(
    items: readonly T[],
    limit: number,
    worker: (item: T) => Promise<R>
): Promise<R[]> {
    const results = new Array<R>(items.length);
    let nextIndex = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const index = nextIndex;
            nextIndex += 1;
            if (index >= items.length) {
                return;
            }
            results[index] = await worker(items[index]);
        }
    });
    await Promise.all(runners);
    return results;
}

export class AiWorkspaceManager {
    private state: AiWorkspaceState | undefined;
    private lastSnapshot: AiWorkspaceSnapshot | undefined;
    private baselineCache: { root: string; data: WorkspaceBaseline } | undefined;
    private manifestCache: { root: string; data: WorkspaceManifestCache } | undefined;

    public constructor(private readonly context: vscode.ExtensionContext) {}

    public getState(): AiWorkspaceState | undefined {
        return this.state;
    }

    public clearState(): void {
        this.state = undefined;
        this.lastSnapshot = undefined;
        this.baselineCache = undefined;
        this.manifestCache = undefined;
    }

    /** 저장한 스냅샷 정보로 `.axis/context.md` 를 다시 만든다. 상태·접속자가 바뀐 뒤 호출한다. */
    public async refreshContext(): Promise<string> {
        const root = this.state?.rootPath;
        if (!root || !this.state) {
            throw new Error('AI 작업공간이 아직 준비되지 않았습니다.');
        }

        const snapshot: AiWorkspaceSnapshot = this.lastSnapshot ?? {
            repo_id: this.state.repoId,
            branch: this.state.branch,
            head_sha: this.state.headSha,
            file_count: this.state.fileCount,
            files: []
        };
        const text = await buildContextMarkdown(snapshot, root, this.state.skippedCount);
        await writeFileAtomic(path.join(root, '.axis', 'context.md'), text);
        return text;
    }

    public getBasePath(): string {
        return path.join(this.context.globalStorageUri.fsPath, 'ai-workspace');
    }

    public getRootPathFor(repoId: number, branch: string): string {
        return path.join(this.getBasePath(), `repo-${repoId}`, `branch-${branchSlug(branch)}`);
    }

    public getCurrentRootPath(): string | undefined {
        const session = getSession();
        const branch = getCurrentBranch();
        return session && branch ? this.getRootPathFor(session.repoId, branch) : undefined;
    }

    public async prepare(mcp: AiBridgeConfig): Promise<AiWorkspaceState> {
        const synced = await this.syncFromServer();
        const warnings = await writeMcpConfigs(synced.root, mcp.mcpScript, mcp.sessionFile);
        await this.alignManagedConfigBaseline(synced.root, synced.baseline);
        try {
            await this.initBaselineGit(synced.root, synced.changedPaths);
        } catch (error) {
            warnings.push(
                `로컬 Git baseline 을 만들지 못했습니다. ${error instanceof Error ? error.message : String(error)}`
            );
        }
        await this.writeBaseline(synced.root, synced.baseline);

        if (warnings.length > 0) {
            synced.state.message = synced.state.message ?? warnings.join(' ');
        }
        return synced.state;
    }

    /**
     * 연결이 끊겼다 돌아왔거나 다른 사용자의 변경 알림을 놓쳤을 때 부른다.
     * MCP 설정은 건드리지 않고 manifest 차이만 다시 맞춘다.
     */
    public async resync(): Promise<AiWorkspaceState> {
        const synced = await this.syncFromServer();
        try {
            await this.initBaselineGit(synced.root, synced.changedPaths);
        } catch {
            // Git baseline 은 다음 동기화에서 다시 맞춘다.
        }
        await this.writeBaseline(synced.root, synced.baseline);
        return synced.state;
    }

    /**
     * 서버 manifest 와 `.axis/manifest.json` 캐시를 비교해 바뀐 파일만 내려받는다.
     * 최초 실행에서도 24MB JSON 하나를 받지 않고 파일별 요청을 병렬로 처리한다.
     */
    private async syncFromServer(): Promise<{
        root: string;
        state: AiWorkspaceState;
        baseline: WorkspaceBaseline;
        changedPaths: string[];
    }> {
        const session = getSession();
        const branch = getCurrentBranch();
        if (!session || !branch) {
            throw new Error('Axis 세션이 없습니다. 앱에서 저장소를 다시 열어 주세요.');
        }

        const root = this.getRootPathFor(session.repoId, branch);
        await fs.mkdir(root, { recursive: true });

        const manifestRows = await apiRequest<AiWorkspaceManifest[]>(
            `/github/repos/workspace/manifest?repo_id=${session.repoId}&branch=${encodeURIComponent(branch)}`
        );
        const manifest = Array.isArray(manifestRows) ? manifestRows[0] : undefined;
        if (!manifest || !Array.isArray(manifest.files)) {
            throw new Error('AI 작업공간 manifest 응답 형식이 올바르지 않습니다.');
        }

        // 디스크의 baseline·manifest 를 기준으로 새로 맞춘다.
        this.baselineCache = undefined;
        this.manifestCache = undefined;
        const baseline = await this.readBaseline(root);
        const cached = await this.readManifestCache(root);
        const applied = await this.applyManifest(root, session.repoId, branch, manifest, cached, baseline);

        const snapshot: AiWorkspaceSnapshot = {
            repo_id: manifest.repo_id,
            branch: manifest.branch,
            head_sha: manifest.head_sha,
            file_count: manifest.file_count,
            total_bytes: manifest.total_bytes,
            truncated: manifest.truncated,
            files: [],
            skipped: manifest.skipped
        };
        this.lastSnapshot = snapshot;
        const contextText = await buildContextMarkdown(snapshot, root, manifest.skipped?.length ?? 0);
        await fs.mkdir(path.join(root, '.axis'), { recursive: true });
        await writeFileAtomic(path.join(root, '.axis', 'context.md'), contextText);

        await this.writeBaseline(root, applied.baseline);
        await this.writeManifestCache(root, applied.manifest);

        const skippedCount = (manifest.skipped?.length ?? 0) + applied.localSkipped;
        const state: AiWorkspaceState = {
            repoId: session.repoId,
            branch,
            rootPath: root,
            headSha: manifest.head_sha,
            fileCount: manifest.file_count ?? manifest.files.length,
            skippedCount,
            preparedAt: Date.now(),
            message:
                applied.localSkipped > 0
                    ? `AI 가 수정한 파일 ${applied.localSkipped}개는 자동으로 덮어쓰지 않았습니다.`
                    : (manifest.skipped?.length ?? 0) > 0
                      ? `서버에서 파일 ${manifest.skipped?.length ?? 0}개를 제외했습니다. (민감 파일·바이너리·인코딩·크기 제한)`
                      : undefined
        };
        this.state = state;
        return { root, state, baseline: applied.baseline, changedPaths: applied.changedPaths };
    }

    private async alignManagedConfigBaseline(root: string, baseline: WorkspaceBaseline): Promise<void> {
        for (const relPath of MANAGED_MCP_CONFIG_PATHS) {
            if (!(relPath in baseline.files)) {
                continue;
            }
            const content = await readFileIfPresent(path.join(root, ...relPath.split('/')));
            if (content !== undefined) {
                baseline.files[relPath] = hashContent(content);
            }
        }
    }

    public async reset(): Promise<void> {
        const root = this.state?.rootPath ?? this.getCurrentRootPath();
        if (!root) {
            return;
        }

        const base = path.resolve(this.getBasePath());
        const resolved = path.resolve(root);
        if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
            throw new Error('AI 작업공간 경로가 저장소 범위를 벗어났습니다.');
        }

        await fs.rm(resolved, { recursive: true, force: true });
        this.state = undefined;
        this.lastSnapshot = undefined;
        this.baselineCache = undefined;
        this.manifestCache = undefined;
    }

    public async listFiles(): Promise<string[]> {
        const root = this.state?.rootPath;
        if (!root) {
            return [];
        }

        const result: string[] = [];
        const skip = new Set(['.git', '.axis', '.codex', '.antigravity', 'node_modules', '.worktrees']);
        const walk = async (directory: string, prefix: string): Promise<void> => {
            if (result.length >= 5000) {
                return;
            }

            let entries;
            try {
                entries = await fs.readdir(directory, { withFileTypes: true });
            } catch {
                return;
            }

            entries.sort((a, b) => a.name.localeCompare(b.name));
            for (const entry of entries) {
                if (entry.name === '.mcp.json' || skip.has(entry.name)) {
                    continue;
                }
                const relative = prefix.length > 0 ? `${prefix}/${entry.name}` : entry.name;
                if (isSensitiveAiWorkspacePath(relative)) {
                    continue;
                }
                if (entry.isDirectory()) {
                    await walk(path.join(directory, entry.name), relative);
                } else if (entry.isFile()) {
                    result.push(relative);
                }
                if (result.length >= 5000) {
                    return;
                }
            }
        };

        await walk(root, '');
        return result;
    }

    public async readLocalFile(relPath: string): Promise<string> {
        const root = this.state?.rootPath;
        if (!root || !isSafeAiWorkspacePath(relPath) || isSensitiveAiWorkspacePath(relPath)) {
            throw new Error(`읽을 수 없는 경로입니다: ${relPath}`);
        }
        const content = await readFileIfPresent(localPath(root, relPath));
        if (content === undefined) {
            throw new Error(`파일이 없거나 너무 큽니다: ${relPath}`);
        }
        return content;
    }

    /**
     * 파일 감시자가 본 로컬 상태와 마지막 baseline 해시를 함께 돌려준다.
     * `content === undefined` + `baselineHash` 없음은 "새로 만들었다가 지워짐"이라 동기화할 것이 없다.
     */
    public async readSyncState(relPath: string): Promise<{
        content?: string;
        currentHash?: string;
        baselineHash?: string;
        skipReason?: string;
    }> {
        const root = this.state?.rootPath;
        if (!root || !isSafeAiWorkspacePath(relPath) || isSensitiveAiWorkspacePath(relPath)) {
            return { skipReason: 'unsafe' };
        }

        const baseline = await this.readBaseline(root);
        const baselineHash = baseline?.files[relPath];
        const file = localPath(root, relPath);
        try {
            const stat = await fs.lstat(file);
            if (stat.isSymbolicLink() || !stat.isFile()) {
                return { baselineHash, skipReason: 'not_file' };
            }
            if (stat.size > MAX_SYNC_FILE_BYTES) {
                return { baselineHash, skipReason: 'too_large' };
            }
            let content: string;
            try {
                content = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await fs.readFile(file));
            } catch {
                return { baselineHash, skipReason: 'encoding' };
            }
            return { content, currentHash: hashContent(content), baselineHash };
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
                return { baselineHash };
            }
            return { baselineHash, skipReason: 'unreadable' };
        }
    }

    /** 서버에서 삭제가 확정된 뒤 baseline 에서도 지운다. */
    public async recordLocalDelete(relPath: string): Promise<void> {
        const root = this.state?.rootPath;
        if (!root || !isSafeAiWorkspacePath(relPath)) {
            return;
        }

        await fs.rm(localPath(root, relPath), { force: true }).catch(() => undefined);

        const cached = await this.readManifestCache(root);
        if (cached && relPath in cached.files) {
            delete cached.files[relPath];
            await this.writeManifestCache(root, cached);
        }

        const baseline = await this.readBaseline(root);
        if (!baseline || !(relPath in baseline.files)) {
            return;
        }
        delete baseline.files[relPath];
        await this.writeBaseline(root, baseline);
    }

    /**
     * MCP 로 최신 서버 내용을 읽었을 때 작업공간 사본도 맞춘다.
     * AI 가 이미 고친 파일(로컬 해시 != baseline)이나 삭제한 파일은 건드리지 않는다.
     */
    public async adoptServerFile(relPath: string, content: string, hash?: string): Promise<boolean> {
        const root = this.state?.rootPath;
        if (!root || !isSafeAiWorkspacePath(relPath) || isSensitiveAiWorkspacePath(relPath)) {
            return false;
        }

        const baseline = await this.readBaseline(root);
        if (!baseline) {
            return false; // baseline 이 없으면 어떤 파일이 AI 수정인지 판단할 수 없다.
        }
        const status = await this.mergeServerContent(root, baseline, relPath, content, hash, false);
        await this.writeBaseline(root, baseline);
        return status === 'written';
    }

    /** MCP 또는 브리지를 거친 쓰기를 로컬 작업공간과 baseline 에 반영한다. */
    public async applyLocalWrite(relPath: string, content: string): Promise<void> {
        const root = this.state?.rootPath;
        if (!root || isSensitiveAiWorkspacePath(relPath)) {
            return;
        }
        const file = localPath(root, relPath);
        await writeFileAtomic(file, content);
        const cached = await this.readManifestCache(root);
        if (cached && relPath in cached.files) {
            // 서버 버전 토큰은 쓰기 응답에 없으므로 다음 manifest 동기화에서 한 번 다시 확인한다.
            delete cached.files[relPath];
            await this.writeManifestCache(root, cached);
        }
        const baseline = await this.readBaseline(root);
        if (baseline) {
            baseline.files[relPath] = hashContent(content);
            await this.writeBaseline(root, baseline);
        }
    }

    /**
     * 제어 WebSocket 으로 받은 경로만 골라 서버 최신 내용을 작업공간에 반영한다.
     * AI 가 수정 중인 파일은 덮어쓰지 않고 충돌 수를 돌려준다.
     */
    public async applyServerChanges(changes: {
        paths?: readonly string[];
        deletes?: readonly string[];
    }): Promise<ServerApplyResult> {
        const root = this.state?.rootPath;
        const state = this.state;
        const session = getSession();
        if (!root || !state || !session) {
            return { written: 0, deleted: 0, conflicts: 0 };
        }
        const baseline = await this.readBaseline(root);
        if (!baseline) {
            return { written: 0, deleted: 0, conflicts: 0 };
        }

        const cached = (await this.readManifestCache(root)) ?? { version: 1 as const, files: {} };
        const changedPaths: string[] = [];
        let written = 0;
        let deleted = 0;
        let conflicts = 0;

        for (const relPath of new Set(changes.deletes ?? [])) {
            if (!isSafeAiWorkspacePath(relPath) || shouldIgnoreAiWorkspacePath(relPath)) {
                continue;
            }
            const status = await this.applyServerDelete(root, baseline, relPath);
            if (status === 'deleted') {
                deleted += 1;
                changedPaths.push(relPath);
                delete cached.files[relPath];
            } else if (status === 'conflict') {
                conflicts += 1;
            } else {
                delete cached.files[relPath];
            }
        }

        for (const relPath of new Set(changes.paths ?? [])) {
            if (!isSafeAiWorkspacePath(relPath) || shouldIgnoreAiWorkspacePath(relPath)) {
                continue;
            }
            const download = await this.downloadManifestFile(session.repoId, state.branch, relPath);
            if (download.kind === 'error') {
                continue;
            }
            if (download.kind === 'missing') {
                const status = await this.applyServerDelete(root, baseline, relPath);
                if (status === 'deleted') {
                    deleted += 1;
                    changedPaths.push(relPath);
                    delete cached.files[relPath];
                } else if (status === 'conflict') {
                    conflicts += 1;
                } else {
                    delete cached.files[relPath];
                }
                continue;
            }
            if (download.kind === 'omitted') {
                if (download.version) {
                    cached.files[relPath] = { size: 0, version: download.version };
                }
                continue;
            }

            const status = await this.mergeServerContent(root, baseline, relPath, download.content, download.hash);
            if (status === 'written') {
                written += 1;
                changedPaths.push(relPath);
            } else if (status === 'conflict' || status === 'deleted-locally') {
                conflicts += 1;
            }
            if (download.version) {
                cached.files[relPath] = {
                    size: Buffer.byteLength(download.content, 'utf8'),
                    version: download.version
                };
            } else {
                delete cached.files[relPath];
            }
        }

        await this.writeBaseline(root, baseline);
        await this.writeManifestCache(root, cached);
        if (changedPaths.length > 0) {
            try {
                await this.initBaselineGit(root, changedPaths);
            } catch {
                // Git baseline 커밋은 다음 동기화에서 다시 맞춘다.
            }
        }
        return { written, deleted, conflicts };
    }

    /** manifest 목록과 로컬 캐시를 비교해 바뀐 파일만 내려받아 반영한다. */
    private async applyManifest(
        root: string,
        repoId: number,
        branch: string,
        manifest: AiWorkspaceManifest,
        cached: WorkspaceManifestCache | undefined,
        baseline: WorkspaceBaseline | undefined
    ): Promise<ApplyResult> {
        const working: WorkspaceBaseline = { version: 1, files: { ...(baseline?.files ?? {}) } };
        const nextManifest: WorkspaceManifestCache = { version: 1, files: { ...(cached?.files ?? {}) } };
        const present = new Set<string>();
        for (const skipped of manifest.skipped ?? []) {
            present.add(skipped.path);
        }

        const changedPaths: string[] = [];
        const downloads: AiWorkspaceManifestEntry[] = [];
        let localSkipped = 0;
        let written = 0;

        for (const entry of manifest.files) {
            if (!isSafeAiWorkspacePath(entry.path) || isSensitiveAiWorkspacePath(entry.path)) {
                continue;
            }
            present.add(entry.path);

            const current = await readFileIfPresent(localPath(root, entry.path));
            const baselineHash = working.files[entry.path];
            const currentHash = current === undefined ? undefined : hashContent(current);
            if (cached?.files[entry.path]?.version === entry.version) {
                if (currentHash !== undefined && currentHash === baselineHash) {
                    continue; // 서버·로컬 모두 그대로다.
                }
                if (baseline !== undefined && currentHash === undefined && baselineHash === undefined) {
                    continue; // AI 가 지운 파일을 되살리지 않는다.
                }
                if (baseline !== undefined && currentHash === undefined && baselineHash !== undefined) {
                    localSkipped += 1; // AI 가 지운 추적 파일
                    continue;
                }
                if (baseline !== undefined && currentHash !== undefined && currentHash !== baselineHash) {
                    localSkipped += 1; // 이미 알려진 AI 수정 충돌
                    continue;
                }
            }
            downloads.push(entry);
        }

        await mapWithConcurrency(downloads, MAX_DOWNLOAD_CONCURRENCY, async (entry) => {
            const download = await this.downloadManifestFile(repoId, branch, entry.path);
            if (download.kind === 'error' || download.kind === 'missing') {
                return;
            }
            if (download.kind === 'omitted') {
                nextManifest.files[entry.path] = { size: entry.size, version: entry.version };
                return;
            }

            const status = await this.mergeServerContent(
                root,
                working,
                entry.path,
                download.content,
                download.hash,
                baseline === undefined
            );
            if (status === 'written') {
                changedPaths.push(entry.path);
                written += 1;
            } else if (status === 'conflict' || status === 'deleted-locally') {
                localSkipped += 1;
            }
            nextManifest.files[entry.path] = { size: entry.size, version: entry.version };
        });

        let deleted = 0;
        // 목록이 잘렸으면 서버에 있지만 manifest 에 없는 파일을 지울 수 있으므로 삭제를 건너뛴다.
        if (baseline && manifest.complete !== false) {
            for (const relPath of Object.keys(working.files)) {
                if (present.has(relPath) || !isSafeAiWorkspacePath(relPath)) {
                    continue;
                }
                const status = await this.applyServerDelete(root, working, relPath);
                if (status === 'deleted') {
                    changedPaths.push(relPath);
                    deleted += 1;
                    delete nextManifest.files[relPath];
                } else if (status === 'conflict') {
                    localSkipped += 1;
                }
            }
        }

        return { baseline: working, manifest: nextManifest, localSkipped, deleted, written, changedPaths };
    }

    private async downloadManifestFile(repoId: number, branch: string, relPath: string): Promise<DownloadResult> {
        try {
            const rows = await apiRequest<Array<{
                content?: unknown;
                content_hash?: unknown;
                version?: unknown;
                content_omitted?: unknown;
            }>>(
                `/github/repos/file?repo_id=${repoId}` +
                    `&branch=${encodeURIComponent(branch)}` +
                    `&path=${encodeURIComponent(relPath)}&ref=worktree`
            );
            const row = Array.isArray(rows) ? rows[0] : undefined;
            if (!row) {
                return { kind: 'missing' };
            }
            if (row.content_omitted === true) {
                return { kind: 'omitted', version: typeof row.version === 'string' ? row.version : undefined };
            }
            if (typeof row.content !== 'string') {
                return { kind: 'error' };
            }
            return {
                kind: 'content',
                content: row.content,
                hash: typeof row.content_hash === 'string' ? row.content_hash : undefined,
                version: typeof row.version === 'string' ? row.version : undefined
            };
        } catch (error) {
            if (error instanceof ApiError && error.status === 404) {
                return { kind: 'missing' };
            }
            return { kind: 'error' };
        }
    }

    private async mergeServerContent(
        root: string,
        baseline: WorkspaceBaseline,
        relPath: string,
        content: string,
        hash?: string,
        firstRun = false
    ): Promise<'written' | 'unchanged' | 'conflict' | 'deleted-locally'> {
        const target = localPath(root, relPath);
        const local = await readFileIfPresent(target);
        const localHash = local === undefined ? undefined : hashContent(local);
        const baselineHash = baseline.files[relPath];
        const serverHash = hash ?? hashContent(content);

        if (localHash === serverHash) {
            baseline.files[relPath] = serverHash;
            return 'unchanged';
        }
        // baseline 이 이미 있는데 이 파일 항목만 없으면 AI 가 새로 만든 파일일 수 있다.
        if (localHash !== undefined && baselineHash === undefined && !firstRun) {
            return 'conflict';
        }
        // AI 가 baseline 이후 수정한 파일은 다른 사용자의 내용으로 덮어쓰지 않는다.
        if (localHash !== undefined && baselineHash !== undefined && localHash !== baselineHash) {
            return 'conflict';
        }
        // AI 가 지운 파일을 서버 내용으로 되살리지 않는다.
        if (localHash === undefined && baselineHash !== undefined) {
            return 'deleted-locally';
        }

        await writeFileAtomic(target, content);
        baseline.files[relPath] = serverHash;
        return 'written';
    }

    private async applyServerDelete(
        root: string,
        baseline: WorkspaceBaseline,
        relPath: string
    ): Promise<'deleted' | 'absent' | 'conflict'> {
        const target = localPath(root, relPath);
        const local = await readFileIfPresent(target);
        if (local === undefined) {
            if (relPath in baseline.files) {
                delete baseline.files[relPath];
                return 'deleted';
            }
            return 'absent';
        }

        const baselineHash = baseline.files[relPath];
        if (baselineHash !== undefined && hashContent(local) === baselineHash) {
            await fs.rm(target, { force: true });
            delete baseline.files[relPath];
            return 'deleted';
        }
        // AI 가 새로 만들었거나 수정한 파일은 서버 삭제 이벤트로 지우지 않는다.
        return 'conflict';
    }

    private async readBaseline(root: string): Promise<WorkspaceBaseline | undefined> {
        if (this.baselineCache?.root === root) {
            return this.baselineCache.data;
        }
        try {
            const parsed: unknown = JSON.parse(await fs.readFile(path.join(root, '.axis', 'baseline.json'), 'utf8'));
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                return undefined;
            }
            const record = parsed as { version?: unknown; files?: unknown };
            if (record.version !== 1 || typeof record.files !== 'object' || record.files === null || Array.isArray(record.files)) {
                return undefined;
            }
            const files: Record<string, string> = {};
            for (const [key, value] of Object.entries(record.files)) {
                if (typeof value === 'string') {
                    files[key] = value;
                }
            }
            const baseline: WorkspaceBaseline = { version: 1, files };
            this.baselineCache = { root, data: baseline };
            return baseline;
        } catch {
            return undefined;
        }
    }

    private async writeBaseline(root: string, baseline: WorkspaceBaseline): Promise<void> {
        const file = path.join(root, '.axis', 'baseline.json');
        await writeFileAtomic(file, `${JSON.stringify(baseline, null, 2)}\n`);
        this.baselineCache = { root, data: baseline };
    }

    private async readManifestCache(root: string): Promise<WorkspaceManifestCache | undefined> {
        if (this.manifestCache?.root === root) {
            return this.manifestCache.data;
        }
        try {
            const parsed: unknown = JSON.parse(
                await fs.readFile(path.join(root, '.axis', 'manifest.json'), 'utf8')
            );
            if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
                return undefined;
            }
            const record = parsed as { version?: unknown; files?: unknown };
            if (record.version !== 1 || typeof record.files !== 'object' || record.files === null || Array.isArray(record.files)) {
                return undefined;
            }

            const files: WorkspaceManifestCache['files'] = {};
            for (const [key, value] of Object.entries(record.files)) {
                if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                    continue;
                }
                const entry = value as { size?: unknown; version?: unknown };
                if (typeof entry.size === 'number' && typeof entry.version === 'string') {
                    files[key] = { size: entry.size, version: entry.version };
                }
            }

            const cache: WorkspaceManifestCache = { version: 1, files };
            this.manifestCache = { root, data: cache };
            return cache;
        } catch {
            return undefined;
        }
    }

    private async writeManifestCache(root: string, cache: WorkspaceManifestCache): Promise<void> {
        const file = path.join(root, '.axis', 'manifest.json');
        await writeFileAtomic(file, `${JSON.stringify(cache, null, 2)}\n`);
        this.manifestCache = { root, data: cache };
    }

    private async initBaselineGit(root: string, changedPaths: readonly string[]): Promise<void> {
        const firstInit = !(await pathExists(path.join(root, '.git')));
        if (firstInit) {
            await runGit(root, ['init']);
        }

        const excludeFile = path.join(root, '.git', 'info', 'exclude');
        await fs.mkdir(path.dirname(excludeFile), { recursive: true });
        let exclude = '';
        try {
            exclude = await fs.readFile(excludeFile, 'utf8');
        } catch {
            exclude = '';
        }
        const lines = new Set(exclude.split(/\r?\n/).filter((line) => line.length > 0));
        for (const entry of ['.axis/', '.codex/', '.antigravity/', '.mcp.json']) {
            lines.add(entry);
        }
        await fs.writeFile(excludeFile, `${Array.from(lines).join('\n')}\n`, 'utf8');

        await runGit(root, ['config', 'user.name', 'Axis AI Workspace']);
        await runGit(root, ['config', 'user.email', 'axis-ai-workspace@localhost']);

        // 첫 준비에서만 전체 스냅샷을 baseline 커밋으로 만든다. 이후에는 서버에서 실제로 바뀐
        // 파일만 stage 한다 — AI 가 직접 고친 파일을 baseline 커밋에 섞지 않기 위해서다.
        // 확장이 만든 설정·민감 경로는 `.git/info/exclude` 로도 제외되므로 명시적 `git add` 대상에서 뺀다.
        const paths = Array.from(new Set(changedPaths)).filter(
            (item) => isSafeAiWorkspacePath(item) && !shouldIgnoreAiWorkspacePath(item)
        );
        if (firstInit) {
            await runGit(root, ['add', '-A']);
        } else if (paths.length > 0) {
            // Windows 명령행 길이 제한을 피하려고 path 를 나눠 stage 한다.
            for (let index = 0; index < paths.length; index += 100) {
                await runGit(root, ['add', '--', ...paths.slice(index, index + 100)]);
            }
        }

        if ((firstInit || paths.length > 0) && (await hasStagedChanges(root))) {
            await runGit(root, ['commit', '--no-gpg-sign', '-m', 'Axis AI workspace baseline']);
        }
    }
}
