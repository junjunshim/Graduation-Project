import * as vscode from 'vscode';

import { getRepositoryDisplayName, getSession } from '../repo/repoSession';
import type { AiManager } from './aiManager';

const VIEW_ID = 'axis-share-ai';

type AiNode =
    | { kind: 'message'; label: string; description?: string }
    | { kind: 'session'; label: string; description: string }
    | { kind: 'workspace'; label: string; description: string; tooltip: string }
    | { kind: 'action'; label: string; command: string; icon: string; description?: string; args?: unknown[] };

export class AiViewProvider implements vscode.TreeDataProvider<AiNode> {
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    public readonly onDidChangeTreeData = this.changeEmitter.event;

    public constructor(private readonly manager: AiManager) {}

    public refresh(): void {
        this.changeEmitter.fire();
    }

    public getTreeItem(node: AiNode): vscode.TreeItem {
        if (node.kind === 'message') {
            const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('info');
            item.description = node.description;
            item.tooltip = node.description ?? node.label;
            return item;
        }

        if (node.kind === 'session') {
            const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('repo');
            item.description = node.description;
            return item;
        }

        if (node.kind === 'workspace') {
            const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('folder');
            item.description = node.description;
            item.tooltip = node.tooltip;
            return item;
        }

        const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.description = node.description;
        item.command = {
            command: node.command,
            title: node.label,
            arguments: node.args
        };
        return item;
    }

    public getChildren(element?: AiNode): AiNode[] {
        if (element) {
            return [];
        }

        const state = this.manager.getViewState();
        const nodes: AiNode[] = [];
        if (state.message) {
            nodes.push({ kind: 'message', label: state.message });
        }

        if (state.sessionRepoId && state.sessionBranch) {
            const session = getSession();
            nodes.push({
                kind: 'session',
                label: getRepositoryDisplayName(session) ?? `저장소 ${state.sessionRepoId}`,
                description: state.sessionBranch
            });
        } else {
            nodes.push({
                kind: 'message',
                label: 'AI 세션 대기 중',
                description: '앱에서 VSCode 로 실시간 편집을 열어 주세요.'
            });
        }

        if (state.workspace) {
            nodes.push({
                kind: 'workspace',
                label: 'AI 작업공간',
                description: `${state.workspace.fileCount}개 파일 · ${state.workspace.branch}`,
                tooltip: `${state.workspace.rootPath}\n${state.workspace.message ?? ''}`
            });
        }

        nodes.push({ kind: 'action', label: 'MCP 설정 보기', command: 'axis-share.ai.configureMcp', icon: 'json' });
        return nodes;
    }

    public dispose(): void {
        this.changeEmitter.dispose();
    }
}

export function createAiView(context: vscode.ExtensionContext, manager: AiManager): {
    provider: AiViewProvider;
    view: vscode.TreeView<AiNode>;
} {
    const provider = new AiViewProvider(manager);
    const view = vscode.window.createTreeView(VIEW_ID, { treeDataProvider: provider, showCollapseAll: false });
    const subscription = manager.onDidChange(() => provider.refresh());
    context.subscriptions.push(view, provider, subscription);
    return { provider, view };
}
