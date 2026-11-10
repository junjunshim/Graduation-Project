import { ApiError, apiRequest } from '../api';
import { getCurrentBranch, getSession } from '../repo/repoSession';
import { isSensitiveAiWorkspacePath, isSafeAiWorkspacePath, type AiWorkspaceManager } from './workspaceManager';

type WriteResponse = {
    path?: string;
    content_hash?: string;
    size?: number;
    created?: boolean;
};

function requireString(args: Record<string, unknown>, key: string): string {
    const value = args[key];
    if (typeof value !== 'string') {
        throw new Error(`${key} 문자열이 필요합니다.`);
    }
    return value;
}

function requireSafePath(value: unknown): string {
    if (typeof value !== 'string') {
        throw new Error('path 문자열이 필요합니다.');
    }
    if (!isSafeAiWorkspacePath(value) || isSensitiveAiWorkspacePath(value)) {
        throw new Error(`쓸 수 없는 경로입니다: ${value}`);
    }
    return value;
}

function conflictError(error: ApiError): Error {
    return new Error(
        JSON.stringify({
            code: 'CONFLICT',
            message: error.message,
            data: error.data
        })
    );
}

export class AiFileWriteBridge {
    public constructor(private readonly workspace: AiWorkspaceManager) {}

    public async write(args: Record<string, unknown>): Promise<unknown> {
        const session = getSession();
        const branch = getCurrentBranch();
        if (!session || !branch) {
            throw new Error('Axis 세션이 없습니다.');
        }

        const path = requireString(args, 'path');
        const content = requireString(args, 'content');
        const expected = typeof args.expected_hash === 'string' ? args.expected_hash : undefined;
        requireSafePath(path);

        try {
            const rows = await apiRequest<WriteResponse[]>('/github/repos/file', {
                method: 'PUT',
                body: {
                    repo_id: session.repoId,
                    branch,
                    path,
                    content,
                    expected_hash: expected ?? ''
                }
            });
            const row = Array.isArray(rows) ? rows[0] : undefined;
            await this.workspace.applyLocalWrite(path, content);
            return {
                path,
                content_hash: row?.content_hash,
                size: row?.size ?? Buffer.byteLength(content, 'utf8'),
                created: row?.created === true
            };
        } catch (error) {
            if (error instanceof ApiError && error.code === 'P0816') {
                throw conflictError(error);
            }
            throw error;
        }
    }

    /** CAS 기반 삭제. 기대 해시가 없거나 다르면 서버가 P0816 으로 거부한다. */
    public async remove(args: Record<string, unknown>): Promise<unknown> {
        const session = getSession();
        const branch = getCurrentBranch();
        if (!session || !branch) {
            throw new Error('Axis 세션이 없습니다.');
        }

        const path = requireSafePath(args.path);
        const expected = typeof args.expected_hash === 'string' ? args.expected_hash : '';

        try {
            const rows = await apiRequest<Array<{ path?: string; deleted?: boolean; already_absent?: boolean }>>(
                '/github/repos/file',
                {
                    method: 'PUT',
                    body: {
                        repo_id: session.repoId,
                        branch,
                        path,
                        deleted: true,
                        expected_hash: expected
                    }
                }
            );
            await this.workspace.recordLocalDelete(path);
            return Array.isArray(rows) && rows.length > 0 ? rows[0] : { path, deleted: true };
        } catch (error) {
            if (error instanceof ApiError && error.code === 'P0816') {
                throw conflictError(error);
            }
            throw error;
        }
    }

    /** 현재 브랜치의 파일을 스테이징하거나 해제한다. 커밋 자체는 사용자가 Changes 뷰에서 한다. */
    public async setStaged(args: Record<string, unknown>, staged: boolean): Promise<unknown> {
        const session = getSession();
        const branch = getCurrentBranch();
        if (!session || !branch) {
            throw new Error('Axis 세션이 없습니다.');
        }

        const raw = args.paths;
        if (!Array.isArray(raw) || raw.length === 0) {
            throw new Error('paths 배열이 필요합니다.');
        }
        const paths = raw.map((value) => requireSafePath(value));

        const status = await apiRequest<unknown[]>('/github/repos/stage', {
            method: staged ? 'POST' : 'DELETE',
            body: { repo_id: session.repoId, branch, paths }
        });
        return { staged, status: Array.isArray(status) ? status : [] };
    }
}
