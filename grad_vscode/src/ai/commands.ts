import * as vscode from 'vscode';

import type { AiManager } from './aiManager';
import { isAiProviderId } from './providerRegistry';

function showError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    void vscode.window.showErrorMessage(`Axis Share: ${message}`);
}

function providerArg(value: unknown): import('./types').AiProviderId | undefined {
    return isAiProviderId(value) ? value : undefined;
}

export function registerAiCommands(context: vscode.ExtensionContext, manager: AiManager): void {
    context.subscriptions.push(
        vscode.commands.registerCommand('axis-share.ai.openTerminal', (id?: unknown) => {
            void manager.openTerminal(providerArg(id)).catch(showError);
        }),
        vscode.commands.registerCommand('axis-share.ai.launchProvider', (id?: unknown) => {
            void manager.launchProvider(providerArg(id)).catch(showError);
        }),
        vscode.commands.registerCommand('axis-share.ai.syncWorkspace', () => {
            void manager.syncWorkspace().catch(showError);
        }),
        vscode.commands.registerCommand('axis-share.ai.resetWorkspace', () => {
            void manager.resetWorkspace().catch(showError);
        }),
        vscode.commands.registerCommand('axis-share.ai.configureMcp', () => {
            void manager.configureMcp().catch(showError);
        }),
        vscode.commands.registerCommand('axis-share.ai.stopSession', () => {
            void manager.stopSession().catch(showError);
        })
    );
}
