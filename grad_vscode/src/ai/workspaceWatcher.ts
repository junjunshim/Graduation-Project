import * as path from 'node:path';

import * as vscode from 'vscode';

import { shouldIgnoreAiWorkspacePath } from './workspaceManager';

const DEBOUNCE_MS = 900;

/**
 * AI 작업공간의 디스크 변경을 모아 한 번에 알린다.
 *
 * Codex·Claude 같은 CLI 는 MCP 도구가 아니라 자체 파일 편집 도구로 디스크를 고치는 경우가 많다.
 * 그 변경을 서버에 반영하려면 파일 감시가 필요하다. 편집기가 임시 파일을 만들고 rename 하는
 * 과정에서 이벤트가 여러 번 오므로 경로를 모아 디바운스한다.
 */
export class AiWorkspaceWatcher implements vscode.Disposable {
    private watcher: vscode.FileSystemWatcher | undefined;
    private root: string | undefined;
    private timer: NodeJS.Timeout | undefined;
    private readonly pending = new Set<string>();
    private readonly disposables: vscode.Disposable[] = [];

    public constructor(private readonly onChange: (paths: string[]) => void) {}

    public start(root: string): void {
        if (this.watcher && this.root === root) {
            return;
        }
        this.stop();
        this.root = root;

        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(vscode.Uri.file(root), '**/*')
        );
        const enqueue = (uri: vscode.Uri): void => {
            const relative = this.relative(uri);
            if (!relative) {
                return;
            }
            this.pending.add(relative);
            this.schedule();
        };

        this.disposables.push(
            watcher.onDidCreate(enqueue),
            watcher.onDidChange(enqueue),
            watcher.onDidDelete(enqueue),
            watcher
        );
        this.watcher = watcher;
    }

    public stop(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        this.pending.clear();
        for (const disposable of this.disposables.splice(0)) {
            disposable.dispose();
        }
        this.watcher = undefined;
        this.root = undefined;
    }

    public dispose(): void {
        this.stop();
    }

    private relative(uri: vscode.Uri): string | undefined {
        if (!this.root || uri.scheme !== 'file') {
            return undefined;
        }

        const relative = path.relative(this.root, uri.fsPath);
        if (relative.length === 0 || relative.startsWith('..') || path.isAbsolute(relative)) {
            return undefined;
        }
        const posix = relative.split(path.sep).join('/');
        return shouldIgnoreAiWorkspacePath(posix) ? undefined : posix;
    }

    private schedule(): void {
        if (this.timer) {
            clearTimeout(this.timer);
        }
        this.timer = setTimeout(() => {
            this.timer = undefined;
            this.flush();
        }, DEBOUNCE_MS);
    }

    private flush(): void {
        if (this.pending.size === 0) {
            return;
        }
        const paths = Array.from(this.pending);
        this.pending.clear();
        this.onChange(paths);
    }
}
