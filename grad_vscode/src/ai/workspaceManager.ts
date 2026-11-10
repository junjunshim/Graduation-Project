import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { TextDecoder } from 'node:util';

import * as vscode from 'vscode';

import { apiRequest } from '../api';
import { getCurrentBranch, getSession } from '../repo/repoSession';
import { branchSlug } from '../repo/repoTreeProvider';
import { buildContextMarkdown } from './contextBuilder';
import { writeMcpConfigs } from './mcpConfig';
import type {
    AiBridgeConfig,
    AiWorkspaceFile,
    AiWorkspaceSnapshot,
    AiWorkspaceState
} from './types';

type WorkspaceBaseline = {
    version: 1;
    files: Record<string, string>;
};

type ApplyResult = {
    baseline: WorkspaceBaseline;
    localSkipped: number;
    deleted: number;
    written: number;
    changedPaths: string[];
};

const MAX_LOCAL_FILE_BYTES = 4 * 1024 * 1024;
// 서버의 AI 쓰기 상한과 같다. 이보다 큰 파일은 자동 동기화 대신 사용자에게 경고한다.
const MAX_SYNC_FILE_BYTES = 512 * 1024;

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

export class AiWorkspaceManager {
    private state: AiWorkspaceState | undefined;
    private lastSnapshot: AiWorkspaceSnapshot | undefined;
    private baselineCache: { root: string; data: WorkspaceBaseline } | undefined;

    public constructor(private readonly context: vscode.ExtensionContext) {}

    public getState(): AiWorkspaceState | undefined {
        return this.state;
    }

    public clearState(): void {
        this.state = undefined;
        this.lastSnapshot = undefined;
        this.baselineCache = undefined;
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
        const session = getSession();
        const branch = getCurrentBranch();
        if (!session || !branch) {
            throw new Error('Axis 세션이 없습니다. 앱에서 저장소를 다시 열어 주세요.');
        }

        const root = this.getRootPathFor(session.repoId, branch);
        await fs.mkdir(root, { recursive: true });

        const snapshotRows = await apiRequest<AiWorkspaceSnapshot[]>(
            `/github/repos/workspace?repo_id=${session.repoId}&branch=${encodeURIComponent(branch)}`
        );
        const snapshot = Array.isArray(snapshotRows) ? snapshotRows[0] : undefined;
        if (!snapshot || !Array.isArray(snapshot.files)) {
            throw new Error('AI 작업공간 스냅샷 응답 형식이 올바르지 않습니다.');
        }

        this.baselineCache = undefined;   // 디스크의 baseline 을 기준으로 새로 맞춘다.
        const baseline = await this.readBaseline(root);
        const applied = await this.applySnapshot(root, snapshot.files, baseline);
        // 컨텍스트 갱신에는 메타데이터만 필요하다. 24MB 스냅샷 본문을 계속 들고 있지 않는다.
        this.lastSnapshot = {
            repo_id: snapshot.repo_id,
            branch: snapshot.branch,
            head_sha: snapshot.head_sha,
            file_count: snapshot.file_count,
            files: [],
            skipped: snapshot.skipped
        };
        const contextText = await buildContextMarkdown(snapshot, root, snapshot.skipped?.length ?? 0);
        await fs.mkdir(path.join(root, '.axis'), { recursive: true });
        await writeFileAtomic(path.join(root, '.axis', 'context.md'), contextText);

        const warnings = await writeMcpConfigs(root, mcp.mcpScript, mcp.sessionFile);
        await this.alignManagedConfigBaseline(root, applied.baseline);
        try {
            await this.initBaselineGit(root, applied.changedPaths);
        } catch (error) {
            warnings.push(
                `로컬 Git baseline 을 만들지 못했습니다. ${error instanceof Error ? error.message : String(error)}`
            );
        }
        await this.writeBaseline(root, applied.baseline);

        this.state = {
            repoId: session.repoId,
            branch,
            rootPath: root,
            headSha: snapshot.head_sha,
            fileCount: snapshot.file_count ?? snapshot.files.length,
            skippedCount: (snapshot.skipped?.length ?? 0) + applied.localSkipped,
            preparedAt: Date.now(),
            message:
                applied.localSkipped > 0
                    ? `AI 가 수정한 파일 ${applied.localSkipped}개는 자동으로 덮어쓰지 않았습니다.`
                    : (snapshot.skipped?.length ?? 0) > 0
                      ? `서버에서 파일 ${snapshot.skipped?.length ?? 0}개를 제외했습니다. (민감 파일·바이너리·인코딩·크기 제한)`
                      : warnings.length > 0
                        ? warnings.join(' ')
                        : undefined
        };
        return this.state;
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

        const file = localPath(root, relPath);
        const baseline = await this.readBaseline(root);
        if (!baseline) {
            return false; // baseline 이 없으면 어떤 파일이 AI 수정인지 판단할 수 없다.
        }
        const baselineHash = baseline.files[relPath];
        const local = await readFileIfPresent(file);
        const localHash = local === undefined ? undefined : hashContent(local);

        if (local === undefined && baselineHash !== undefined) {
            return false; // AI 가 지운 파일을 되살리지 않는다.
        }
        if (local !== undefined && localHash !== baselineHash) {
            return false; // AI 가 수정한 파일을 덮어쓰지 않는다.
        }

        const serverHash = hash ?? hashContent(content);
        if (localHash !== serverHash) {
            await writeFileAtomic(file, content);
        }
        baseline.files[relPath] = serverHash;
        await this.writeBaseline(root, baseline);
        return localHash !== serverHash;
    }

    /** MCP 또는 브리지를 거친 쓰기를 로컬 작업공간과 baseline 에 반영한다. */
    public async applyLocalWrite(relPath: string, content: string): Promise<void> {
        const root = this.state?.rootPath;
        if (!root || isSensitiveAiWorkspacePath(relPath)) {
            return;
        }
        const file = localPath(root, relPath);
        await writeFileAtomic(file, content);
        const baseline = await this.readBaseline(root);
        if (baseline) {
            baseline.files[relPath] = hashContent(content);
            await this.writeBaseline(root, baseline);
        }
    }

    private async applySnapshot(
        root: string,
        files: readonly AiWorkspaceFile[],
        baseline: WorkspaceBaseline | undefined
    ): Promise<ApplyResult> {
        const nextBaseline: WorkspaceBaseline = { version: 1, files: { ...(baseline?.files ?? {}) } };
        const serverPaths = new Set<string>();
        const changedPaths: string[] = [];
        let localSkipped = 0;
        let written = 0;

        for (const file of files) {
            if (!isSafeAiWorkspacePath(file.path) || isSensitiveAiWorkspacePath(file.path)) {
                continue;
            }
            serverPaths.add(file.path);

            const target = localPath(root, file.path);
            const current = await readFileIfPresent(target);
            const currentHash = current === undefined ? undefined : hashContent(current);
            const previousHash = baseline?.files[file.path];
            const desiredHash = file.hash ?? hashContent(file.content);

            // 이미 서버 내용과 같으면 다시 쓰지 않는다. baseline 만 맞춰 두고 다음 파일로 넘어간다.
            if (current !== undefined && currentHash === desiredHash) {
                nextBaseline.files[file.path] = desiredHash;
                continue;
            }

            if (currentHash !== undefined && previousHash !== undefined && currentHash !== previousHash) {
                localSkipped += 1;
                continue;
            }
            if (currentHash !== undefined && baseline !== undefined && previousHash === undefined) {
                localSkipped += 1;
                continue;
            }

            await writeFileAtomic(target, file.content);
            nextBaseline.files[file.path] = desiredHash;
            changedPaths.push(file.path);
            written += 1;
        }

        let deleted = 0;
        if (baseline) {
            for (const [relPath, previousHash] of Object.entries(baseline.files)) {
                if (serverPaths.has(relPath) || !isSafeAiWorkspacePath(relPath)) {
                    continue;
                }
                const target = localPath(root, relPath);
                const current = await readFileIfPresent(target);
                if (current !== undefined && hashContent(current) === previousHash) {
                    await fs.rm(target, { force: true });
                    delete nextBaseline.files[relPath];
                    changedPaths.push(relPath);
                    deleted += 1;
                }
            }
        }

        return { baseline: nextBaseline, localSkipped, deleted, written, changedPaths };
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
