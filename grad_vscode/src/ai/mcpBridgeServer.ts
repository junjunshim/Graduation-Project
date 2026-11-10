import { randomBytes } from 'node:crypto';
import * as fs from 'node:fs/promises';
import * as http from 'node:http';
import * as path from 'node:path';

import type * as vscode from 'vscode';

import type { AiBridgeConfig, AiBridgeSessionFile } from './types';

export type BridgeHandler = (name: string, args: Record<string, unknown>) => Promise<unknown>;

type SessionIdentity = {
    repoId: number;
    branch: string;
    workspaceRoot: string;
    userEmail: string;
};

const MAX_BODY_BYTES = 2 * 1024 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
        const chunks: Buffer[] = [];
        let size = 0;
        req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > MAX_BODY_BYTES) {
                reject(new Error('요청 본문이 너무 큽니다.'));
                req.destroy();
                return;
            }
            chunks.push(chunk);
        });
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

export class AiMcpBridgeServer {
    private server: http.Server | undefined;
    private config: AiBridgeConfig | undefined;
    private identity: SessionIdentity | undefined;
    private sessionId = '';

    public constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly handler: BridgeHandler
    ) {}

    public isRunning(): boolean {
        return this.server !== undefined;
    }

    public getConfig(): AiBridgeConfig | undefined {
        return this.config;
    }

    public async start(identity: SessionIdentity, mcpScript: string): Promise<AiBridgeConfig> {
        this.identity = identity;
        if (this.server && this.config) {
            await this.writeSessionFile();
            return this.config;
        }

        const secret = randomBytes(32).toString('hex');
        this.sessionId = randomBytes(16).toString('hex');
        const sessionFile = path.join(this.context.globalStorageUri.fsPath, 'ai-session.json');

        const server = http.createServer((req, res) => {
            void this.handleRequest(req, res);
        });
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject);
            server.listen(0, '127.0.0.1', () => resolve());
        });

        const address = server.address();
        if (address === null || typeof address === 'string') {
            server.close();
            throw new Error('MCP 브리지 포트를 열지 못했습니다.');
        }

        this.server = server;
        this.config = { port: address.port, secret, sessionFile, mcpScript };
        await this.writeSessionFile();
        return this.config;
    }

    public async updateIdentity(identity: SessionIdentity): Promise<void> {
        this.identity = identity;
        if (this.server && this.config) {
            await this.writeSessionFile();
        }
    }

    public async stop(): Promise<void> {
        const server = this.server;
        this.server = undefined;
        const config = this.config;
        this.config = undefined;
        this.identity = undefined;

        if (server) {
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
                // MCP 프로세스가 남긴 keep-alive 소켓 때문에 close 가 매달리지 않게 한다.
                server.closeAllConnections();
            });
        }
        if (config) {
            await fs.rm(config.sessionFile, { force: true }).catch(() => undefined);
        }
    }

    private async writeSessionFile(): Promise<void> {
        if (!this.config || !this.identity) {
            return;
        }

        const session: AiBridgeSessionFile = {
            version: 1,
            port: this.config.port,
            secret: this.config.secret,
            repoId: this.identity.repoId,
            branch: this.identity.branch,
            workspaceRoot: this.identity.workspaceRoot,
            userEmail: this.identity.userEmail,
            sessionId: this.sessionId
        };
        await fs.mkdir(path.dirname(this.config.sessionFile), { recursive: true });
        await fs.writeFile(this.config.sessionFile, `${JSON.stringify(session, null, 2)}\n`, {
            encoding: 'utf8',
            mode: 0o600
        });
        await fs.chmod(this.config.sessionFile, 0o600).catch(() => undefined);
    }

    private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
        const send = (status: number, body: unknown): void => {
            const payload = JSON.stringify(body);
            res.statusCode = status;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            res.setHeader('Content-Length', Buffer.byteLength(payload));
            res.end(payload);
        };

        if (req.method === 'GET' && req.url === '/health') {
            send(200, { ok: true });
            return;
        }
        if (req.method !== 'POST' || req.url !== '/rpc') {
            send(404, { ok: false, error: { code: 'not_found', message: 'Not found' } });
            return;
        }

        const expected = this.config ? `Bearer ${this.config.secret}` : '';
        if (!expected || req.headers.authorization !== expected) {
            send(401, { ok: false, error: { code: 'unauthorized', message: 'Unauthorized' } });
            return;
        }

        try {
            const body: unknown = JSON.parse(await readBody(req));
            if (!isRecord(body) || typeof body.name !== 'string' || !isRecord(body.args)) {
                send(400, { ok: false, error: { code: 'bad_request', message: 'name/args 가 필요합니다.' } });
                return;
            }

            const result = await this.handler(body.name, body.args);
            send(200, { ok: true, result });
        } catch (error) {
            send(200, {
                ok: false,
                error: {
                    code: 'tool_error',
                    message: error instanceof Error ? error.message : String(error)
                }
            });
        }
    }
}
