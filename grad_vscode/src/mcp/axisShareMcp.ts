/*
 * Axis Share MCP stdio server.
 *
 * The AI CLI starts this bundled Node process. Every tool call is forwarded to the
 * extension-host bridge over 127.0.0.1 with the per-session secret stored in
 * AXIS_BRIDGE_FILE. This file must not import `vscode`; it runs outside the
 * extension host.
 */

import * as fs from 'node:fs';
import * as http from 'node:http';
import * as path from 'node:path';
import * as readline from 'node:readline';

const PROTOCOL_VERSION = '2024-11-05';
const SERVER_NAME = 'axis-share';
const SERVER_VERSION = '0.1.0';
const REQUEST_TIMEOUT_MS = 30_000;

type JsonRpcId = string | number | null;

type JsonRpcRequest = {
    jsonrpc?: unknown;
    id?: unknown;
    method?: unknown;
    params?: unknown;
};

type BridgeSession = {
    version: 1;
    port: number;
    secret: string;
    repoId: number;
    branch: string;
    workspaceRoot: string;
    userEmail: string;
    sessionId: string;
};

type ToolDefinition = {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
};

const NO_ARGS_SCHEMA: Record<string, unknown> = {
    type: 'object',
    properties: {},
    additionalProperties: false
};

const TOOLS: readonly ToolDefinition[] = [
    {
        name: 'axis_get_context',
        description:
            'Read the current Axis repository, branch, user, git status, remote sync, presence, and collaboration rules.',
        inputSchema: NO_ARGS_SCHEMA
    },
    {
        name: 'axis_list_files',
        description: 'List files in the current Axis AI workspace (branch snapshot plus untracked files).',
        inputSchema: NO_ARGS_SCHEMA
    },
    {
        name: 'axis_read_file',
        description:
            'Read the latest server worktree content of a file. Always use the returned content_hash before overwriting.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Repository-relative POSIX path, for example src/app.ts.' },
                since: {
                    type: 'string',
                    description: 'Optional previous content_hash. If it is still current, content is omitted.'
                }
            },
            required: ['path'],
            additionalProperties: false
        }
    },
    {
        name: 'axis_get_status',
        description: 'Get staged, modified, and untracked file status for the current branch.',
        inputSchema: NO_ARGS_SCHEMA
    },
    {
        name: 'axis_get_diff',
        description: 'Get a unified diff for the working tree or the staged index.',
        inputSchema: {
            type: 'object',
            properties: {
                mode: { type: 'string', enum: ['working', 'staged'], description: 'Diff base. Defaults to working.' },
                path: { type: 'string', description: 'Optional repository-relative path to limit the diff.' }
            },
            additionalProperties: false
        }
    },
    {
        name: 'axis_get_presence',
        description: 'List users currently connected to each branch of this repository.',
        inputSchema: NO_ARGS_SCHEMA
    },
    {
        name: 'axis_write_file',
        description:
            'Safely write a file through Axis using compare-and-swap. Pass expected_hash for an existing file; on conflict, re-read and merge.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Repository-relative POSIX path.' },
                content: { type: 'string', description: 'Complete new UTF-8 file content.' },
                expected_hash: {
                    type: 'string',
                    description: 'content_hash returned by axis_read_file. Required when the file already exists.'
                }
            },
            required: ['path', 'content'],
            additionalProperties: false
        }
    },
    {
        name: 'axis_delete_file',
        description:
            'Safely delete a file through Axis using compare-and-swap. Pass the content_hash from axis_read_file as expected_hash.',
        inputSchema: {
            type: 'object',
            properties: {
                path: { type: 'string', description: 'Repository-relative POSIX path.' },
                expected_hash: {
                    type: 'string',
                    description: 'content_hash returned by axis_read_file. Required for an existing file.'
                }
            },
            required: ['path'],
            additionalProperties: false
        }
    },
    {
        name: 'axis_stage',
        description: 'Stage files in the current branch. Committing is still a user action in Axis Changes.',
        inputSchema: {
            type: 'object',
            properties: {
                paths: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Repository-relative POSIX paths to stage.'
                }
            },
            required: ['paths'],
            additionalProperties: false
        }
    },
    {
        name: 'axis_unstage',
        description: 'Unstage files in the current branch.',
        inputSchema: {
            type: 'object',
            properties: {
                paths: {
                    type: 'array',
                    items: { type: 'string' },
                    description: 'Repository-relative POSIX paths to unstage.'
                }
            },
            required: ['paths'],
            additionalProperties: false
        }
    }
];

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function bridgeFile(): string {
    const file = process.env.AXIS_BRIDGE_FILE;
    if (!file) {
        throw new Error('AXIS_BRIDGE_FILE is not set. Start the AI terminal from the Axis Share extension.');
    }
    return file;
}

function readBridgeSession(): BridgeSession {
    const parsed: unknown = JSON.parse(fs.readFileSync(bridgeFile(), 'utf8'));
    if (!isRecord(parsed)) {
        throw new Error('Axis bridge session file is invalid.');
    }
    if (
        parsed.version !== 1 ||
        typeof parsed.port !== 'number' ||
        !Number.isInteger(parsed.port) ||
        parsed.port <= 0 ||
        parsed.port > 65_535 ||
        typeof parsed.secret !== 'string' ||
        parsed.secret.length < 32
    ) {
        throw new Error('Axis bridge session file is incomplete.');
    }
    const session = parsed as BridgeSession;
    const expectedRoot = process.env.AXIS_EXPECTED_WORKSPACE;
    if (expectedRoot && normalizeForCompare(expectedRoot) !== normalizeForCompare(session.workspaceRoot)) {
        throw new Error('Axis session now belongs to another workspace. Reopen the AI terminal from Axis Share.');
    }
    return session;
}

function normalizeForCompare(value: string): string {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function requestBridge(name: string, args: Record<string, unknown>): Promise<unknown> {
    const session = readBridgeSession();
    const payload = JSON.stringify({ name, args });

    return new Promise((resolve, reject) => {
        const request = http.request(
            {
                host: '127.0.0.1',
                port: session.port,
                path: '/rpc',
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(payload),
                    Connection: 'close',
                    Authorization: `Bearer ${session.secret}`
                }
            },
            (response) => {
                let body = '';
                response.setEncoding('utf8');
                response.on('data', (chunk: string) => {
                    body += chunk;
                });
                response.on('end', () => {
                    let parsed: unknown;
                    try {
                        parsed = JSON.parse(body);
                    } catch {
                        reject(new Error(`Axis bridge returned an invalid response (HTTP ${response.statusCode ?? 0}).`));
                        return;
                    }
                    if (!isRecord(parsed)) {
                        reject(new Error('Axis bridge returned an invalid response.'));
                        return;
                    }
                    if (parsed.ok === true) {
                        resolve(parsed.result);
                        return;
                    }
                    const error = isRecord(parsed.error) ? parsed.error : undefined;
                    const code = typeof error?.code === 'string' ? error.code : 'tool_error';
                    const message = typeof error?.message === 'string' ? error.message : 'Axis tool failed.';
                    reject(new Error(`${code}: ${message}`));
                });
            }
        );

        request.setTimeout(REQUEST_TIMEOUT_MS, () => {
            request.destroy(new Error('Axis bridge request timed out.'));
        });
        request.on('error', reject);
        request.write(payload);
        request.end();
    });
}

function textResult(value: unknown): Record<string, unknown> {
    let text: string;
    if (isRecord(value) && typeof value.text === 'string' && Object.keys(value).length === 1) {
        text = value.text;
    } else {
        text = JSON.stringify(value, null, 2);
    }
    return { content: [{ type: 'text', text }] };
}

function errorResult(error: unknown): Record<string, unknown> {
    const message = error instanceof Error ? error.message : String(error);
    return {
        content: [{ type: 'text', text: `Axis error: ${message}` }],
        isError: true
    };
}

function send(message: Record<string, unknown>): void {
    process.stdout.write(`${JSON.stringify(message)}\n`);
}

function sendResult(id: JsonRpcId, result: unknown): void {
    send({ jsonrpc: '2.0', id, result });
}

function sendError(id: JsonRpcId, code: number, message: string): void {
    send({ jsonrpc: '2.0', id, error: { code, message } });
}

function asId(value: unknown): JsonRpcId {
    return typeof value === 'string' || typeof value === 'number' ? value : null;
}

async function handleRequest(message: JsonRpcRequest): Promise<void> {
    const method = typeof message.method === 'string' ? message.method : '';
    const isNotification = message.id === undefined;
    const id = asId(message.id);

    if (method === 'notifications/initialized' || method === 'initialized') {
        return;
    }
    if (method === 'ping') {
        if (!isNotification) {
            sendResult(id, {});
        }
        return;
    }
    if (method === 'initialize') {
        const params = isRecord(message.params) ? message.params : {};
        const requestedVersion = typeof params.protocolVersion === 'string' ? params.protocolVersion : '';
        sendResult(id, {
            protocolVersion: requestedVersion || PROTOCOL_VERSION,
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            instructions:
                'Axis Share exposes the current repository branch through MCP. ' +
                'Read files with axis_read_file and always pass the returned content_hash when overwriting.'
        });
        return;
    }
    if (method === 'tools/list') {
        sendResult(id, { tools: TOOLS });
        return;
    }
    if (method === 'tools/call') {
        const params = isRecord(message.params) ? message.params : undefined;
        const name = typeof params?.name === 'string' ? params.name : '';
        const args = isRecord(params?.arguments) ? params.arguments : {};
        const known = TOOLS.some((tool) => tool.name === name);
        if (!known) {
            sendResult(id, errorResult(new Error(`Unknown Axis tool: ${name}`)));
            return;
        }
        try {
            sendResult(id, textResult(await requestBridge(name, args)));
        } catch (error) {
            sendResult(id, errorResult(error));
        }
        return;
    }

    if (!isNotification) {
        sendError(id, -32601, `Method not found: ${method}`);
    }
}

function main(): void {
    const input = readline.createInterface({ input: process.stdin, crlfDelay: Number.POSITIVE_INFINITY });
    input.on('line', (line: string) => {
        const trimmed = line.trim();
        if (trimmed.length === 0) {
            return;
        }

        let parsed: unknown;
        try {
            parsed = JSON.parse(trimmed);
        } catch {
            sendError(null, -32700, 'Parse error');
            return;
        }
        if (!isRecord(parsed)) {
            sendError(null, -32600, 'Invalid Request');
            return;
        }

        void handleRequest(parsed as JsonRpcRequest).catch((error: unknown) => {
            sendError(asId((parsed as JsonRpcRequest).id), -32603, error instanceof Error ? error.message : String(error));
        });
    });
}

process.on('uncaughtException', (error) => {
    process.stderr.write(`[axis-share-mcp] ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
});
process.on('unhandledRejection', (reason) => {
    process.stderr.write(`[axis-share-mcp] unhandled rejection: ${String(reason)}\n`);
});

main();
