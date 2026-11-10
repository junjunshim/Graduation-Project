import * as vscode from 'vscode';

import type { AiProviderDefinition } from './types';

export class AiTerminalManager {
    private readonly terminals = new Map<string, vscode.Terminal>();
    private readonly closeListener = vscode.window.onDidCloseTerminal((closed) => {
        for (const [key, terminal] of this.terminals) {
            if (terminal === closed) {
                this.terminals.delete(key);
            }
        }
    });

    private key(repoId: number, branch: string, providerId: string): string {
        return `${repoId}|${branch}|${providerId}`;
    }

    public open(
        rootPath: string,
        provider: AiProviderDefinition,
        repoId: number,
        branch: string,
        launchCommand?: string
    ): vscode.Terminal {
        const key = this.key(repoId, branch, provider.id);
        const existing = this.terminals.get(key);
        if (existing) {
            existing.show();
            if (launchCommand) {
                existing.sendText(launchCommand, true);
            }
            return existing;
        }

        const terminal = vscode.window.createTerminal({
            name: `Axis AI · ${provider.displayName}`,
            cwd: rootPath,
            env: {
                AXIS_REPO_ID: String(repoId),
                AXIS_BRANCH: branch,
                AXIS_WORKSPACE_ROOT: rootPath,
                AXIS_MCP_CONFIG: `${rootPath}/.axis/mcp.json`,
                AXIS_SESSION_ID: `${repoId}:${branch}`
            }
        });
        this.terminals.set(key, terminal);
        terminal.show();
        if (launchCommand) {
            terminal.sendText(launchCommand, true);
        }
        return terminal;
    }

    public isOpen(): boolean {
        for (const terminal of this.terminals.values()) {
            if (terminal.exitStatus === undefined) {
                return true;
            }
        }
        return false;
    }

    public disposeAll(): void {
        for (const terminal of this.terminals.values()) {
            terminal.dispose();
        }
        this.terminals.clear();
    }

    public dispose(): void {
        this.disposeAll();
        this.closeListener.dispose();
    }
}
