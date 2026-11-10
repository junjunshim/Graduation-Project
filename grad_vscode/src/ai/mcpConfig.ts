import * as fs from 'node:fs/promises';
import * as path from 'node:path';

export type McpServerEntry = {
    command: string;
    args: string[];
    env: Record<string, string>;
};

function mcpServerEntry(mcpScript: string, sessionFile: string, workspaceRoot: string): McpServerEntry {
    return {
        command: process.execPath,
        args: [mcpScript],
        env: {
            ELECTRON_RUN_AS_NODE: '1',
            AXIS_BRIDGE_FILE: sessionFile,
            AXIS_EXPECTED_WORKSPACE: workspaceRoot
        }
    };
}

function tomlString(value: string): string {
    return JSON.stringify(value);
}

function codexToml(entry: McpServerEntry): string {
    const args = entry.args.map(tomlString).join(', ');
    const env = Object.entries(entry.env)
        .map(([key, value]) => `${key} = ${tomlString(value)}`)
        .join(', ');
    return [
        '[mcp_servers.axis-share]',
        `command = ${tomlString(entry.command)}`,
        `args = [${args}]`,
        `env = { ${env} }`,
        ''
    ].join('\n');
}

/** 기존 `[mcp_servers.axis-share]` 섹션만 새 내용으로 바꾸고 나머지 TOML 은 보존한다. */
function replaceCodexSection(existing: string, entry: McpServerEntry): string {
    const marker = '[mcp_servers.axis-share]';
    const lines = existing.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === marker);
    if (start < 0) {
        const separator = existing.endsWith('\n') ? '\n' : '\n\n';
        return `${existing}${separator}${codexToml(entry)}`;
    }

    let end = start + 1;
    while (end < lines.length && !lines[end].trim().startsWith('[')) {
        end += 1;
    }
    const section = codexToml(entry).trimEnd().split('\n');
    return [...lines.slice(0, start), ...section, ...lines.slice(end)].join('\n');
}

async function readJsonObject(file: string): Promise<Record<string, unknown> | undefined> {
    try {
        const parsed: unknown = JSON.parse(await fs.readFile(file, 'utf8'));
        return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : undefined;
    } catch {
        return undefined;
    }
}

async function pathExists(file: string): Promise<boolean> {
    try {
        await fs.access(file);
        return true;
    } catch {
        return false;
    }
}

async function readText(file: string): Promise<string | undefined> {
    try {
        return await fs.readFile(file, 'utf8');
    } catch {
        return undefined;
    }
}

/** 프로젝트 로컬 MCP 설정을 만든다. 기존 사용자 설정은 가능한 한 보존한다. */
export async function writeMcpConfigs(
    workspaceRoot: string,
    mcpScript: string,
    sessionFile: string
): Promise<string[]> {
    const warnings: string[] = [];
    const entry = mcpServerEntry(mcpScript, sessionFile, workspaceRoot);
    const serverConfig = { mcpServers: { 'axis-share': entry } };

    const axisDir = path.join(workspaceRoot, '.axis');
    await fs.mkdir(axisDir, { recursive: true });
    await fs.writeFile(path.join(axisDir, 'mcp.json'), `${JSON.stringify(serverConfig, null, 2)}\n`, 'utf8');

    const claudeConfigPath = path.join(workspaceRoot, '.mcp.json');
    const existingClaude = await readJsonObject(claudeConfigPath);
    if (existingClaude === undefined && (await pathExists(claudeConfigPath))) {
        warnings.push('.mcp.json 이 JSON 객체가 아니어서 덮어쓰지 않았습니다.');
    } else {
        const next = existingClaude ?? {};
        const servers = typeof next.mcpServers === 'object' && next.mcpServers !== null && !Array.isArray(next.mcpServers)
            ? (next.mcpServers as Record<string, unknown>)
            : {};
        next.mcpServers = { ...servers, 'axis-share': entry };
        await fs.writeFile(claudeConfigPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    }

    const antigravityConfigPath = path.join(workspaceRoot, '.antigravity', 'mcp.json');
    const existingAntigravity = await readJsonObject(antigravityConfigPath);
    if (existingAntigravity === undefined && (await pathExists(antigravityConfigPath))) {
        warnings.push('.antigravity/mcp.json 이 JSON 객체가 아니어서 덮어쓰지 않았습니다.');
    } else {
        const next = existingAntigravity ?? {};
        const servers = typeof next.mcpServers === 'object' && next.mcpServers !== null && !Array.isArray(next.mcpServers)
            ? (next.mcpServers as Record<string, unknown>)
            : {};
        next.mcpServers = { ...servers, 'axis-share': entry };
        await fs.mkdir(path.dirname(antigravityConfigPath), { recursive: true });
        await fs.writeFile(antigravityConfigPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    }

    const codexConfigPath = path.join(workspaceRoot, '.codex', 'config.toml');
    const existingCodex = await readText(codexConfigPath);
    if (existingCodex === undefined) {
        await fs.mkdir(path.dirname(codexConfigPath), { recursive: true });
        await fs.writeFile(codexConfigPath, codexToml(entry), 'utf8');
    } else {
        await fs.mkdir(path.dirname(codexConfigPath), { recursive: true });
        await fs.writeFile(codexConfigPath, replaceCodexSection(existingCodex, entry), 'utf8');
    }

    return warnings;
}
