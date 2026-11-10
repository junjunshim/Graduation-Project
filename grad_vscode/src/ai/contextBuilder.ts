import * as path from 'node:path';

import * as vscode from 'vscode';

import { apiRequest } from '../api';
import { getCurrentBranch, getRepositoryDisplayName, getSession } from '../repo/repoSession';
import type { AiWorkspaceSnapshot } from './types';

type StatusRow = {
    path: string;
    state: string;
    staged: boolean;
};

type SyncRow = {
    has_upstream?: boolean;
    head_sha?: string;
    origin_sha?: string;
    ahead?: number;
    behind?: number;
};

type PresenceRow = {
    name: string;
    is_default?: boolean;
    presence?: Array<{ email: string; name?: string }>;
};

async function safeRequest<T>(request: () => Promise<T>): Promise<T | undefined> {
    try {
        return await request();
    } catch {
        return undefined;
    }
}

function editorInfo(rootPath: string): { relativePath?: string; selection?: string; language?: string } {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        return {};
    }

    const documentPath = editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
    const relativeToWorkspace = documentPath ? path.relative(rootPath, documentPath) : '';
    const insideWorkspace =
        relativeToWorkspace.length > 0 &&
        !relativeToWorkspace.startsWith('..') &&
        !path.isAbsolute(relativeToWorkspace);
    const relativePath = insideWorkspace
        ? relativeToWorkspace.split(path.sep).join('/')
        : vscode.workspace.asRelativePath(editor.document.uri, false);

    return {
        relativePath,
        language: editor.document.languageId,
        selection: editor.selection.isEmpty ? undefined : editor.document.getText(editor.selection).slice(0, 4000)
    };
}

/** AI CLI 가 읽을 `.axis/context.md`. 비밀값은 넣지 않고, 서버 상태·작업 규칙만 적는다. */
export async function buildContextMarkdown(
    snapshot: AiWorkspaceSnapshot,
    rootPath: string,
    skippedCount: number
): Promise<string> {
    const session = getSession();
    const branch = getCurrentBranch() ?? snapshot.branch;
    const repoName = getRepositoryDisplayName(session) ?? `repo-${snapshot.repo_id}`;
    const [status, sync, presence] = await Promise.all([
        safeRequest(() =>
            apiRequest<StatusRow[]>(
                `/github/repos/status?repo_id=${snapshot.repo_id}&branch=${encodeURIComponent(branch)}`
            )
        ),
        safeRequest(() =>
            apiRequest<SyncRow[]>(
                `/github/repos/sync?repo_id=${snapshot.repo_id}&branch=${encodeURIComponent(branch)}`
            )
        ),
        safeRequest(() => apiRequest<PresenceRow[]>(`/github/repos/presence?repo_id=${snapshot.repo_id}`))
    ]);
    const current = editorInfo(rootPath);

    const lines: string[] = [
        '# Axis Share AI Context',
        '',
        '## Session',
        `- Repository: ${repoName} (repo_id ${snapshot.repo_id})`,
        `- Branch: ${branch}`,
        `- User: ${session?.userEmail ?? 'unknown'}`,
        `- Workspace: ${rootPath}`,
        `- Head: ${snapshot.head_sha ?? 'unknown'}`,
        `- Files: ${snapshot.file_count ?? snapshot.files.length}`,
        `- Skipped: ${skippedCount}`,
        '',
        '## Git changes',
        ...(status && status.length > 0
            ? status.slice(0, 200).map((row) => `- ${row.staged ? '[staged] ' : ''}${row.state} ${row.path}`)
            : ['- No working tree changes reported.']),
        '',
        '## Remote',
        ...(sync?.[0]
            ? [
                  `- has_upstream: ${sync[0].has_upstream === true}`,
                  `- ahead: ${sync[0].ahead ?? 0}`,
                  `- behind: ${sync[0].behind ?? 0}`,
                  `- head_sha: ${sync[0].head_sha ?? 'unknown'}`,
                  `- origin_sha: ${sync[0].origin_sha ?? 'unknown'}`
              ]
            : ['- Remote sync status unavailable.']),
        '',
        '## Presence',
        ...(presence && presence.length > 0
            ? presence.map((row) => {
                  const people = (row.presence ?? []).map((entry) => entry.name || entry.email).join(', ');
                  return `- ${row.name}${row.is_default ? ' (default)' : ''}: ${people || 'no connected users'}`;
              })
            : ['- Presence unavailable.']),
        '',
        '## Active editor',
        `- File: ${current.relativePath ?? 'none'}`,
        `- Language: ${current.language ?? 'none'}`,
        ...(current.selection ? ['- Selection:', '```text', current.selection, '```'] : ['- Selection: none']),
        '',
        '## Axis rules',
        '- The server worktree and the live Yjs documents are the source of truth.',
        '- Read the latest file before editing. If a write returns CONFLICT/P0816, re-read and merge; never overwrite.',
        '- Direct file edits in this workspace are automatically synced to Axis after a short debounce.',
        '- Use axis_write_file or axis_delete_file when you need an immediate, CAS-checked server write.',
        '- Commit only when the user explicitly asks. Push is disabled unless the user changes Axis settings.',
        '- Do not copy tokens, PATs, .env files, or authentication files into the workspace.',
        '- MCP tools: axis_get_context, axis_list_files, axis_read_file, axis_get_status, axis_get_diff, axis_get_presence, axis_write_file, axis_delete_file, axis_stage, axis_unstage.',
        '',
        `MCP config: ${path.join(rootPath, '.axis', 'mcp.json')}`,
        ''
    ];

    return lines.join('\n');
}
