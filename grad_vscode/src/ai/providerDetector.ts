import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import * as vscode from 'vscode';

import { AI_PROVIDERS, providerPathSetting } from './providerRegistry';
import type { AiProviderDefinition, AiProviderId, ProviderDetection } from './types';

function windowsExecutableNames(command: string): string[] {
    if (process.platform !== 'win32' || path.extname(command).length > 0) {
        return [command];
    }

    const extensions = (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM')
        .split(';')
        .map((item) => item.trim().toLowerCase())
        .filter((item) => item.length > 0);
    return [command, ...extensions.map((extension) => `${command}${extension}`)];
}

async function isRegularFile(candidate: string): Promise<boolean> {
    try {
        const stat = await fs.stat(candidate);
        return stat.isFile();
    } catch {
        return false;
    }
}

export async function findExecutableInPath(command: string, envPath: string | undefined): Promise<string | undefined> {
    const directories = (envPath ?? '')
        .split(path.delimiter)
        .map((item) => item.trim().replace(/^"(.*)"$/u, '$1'))
        .filter((item) => item.length > 0);

    for (const directory of directories) {
        for (const name of windowsExecutableNames(command)) {
            const candidate = path.join(directory, name);
            if (await isRegularFile(candidate)) {
                return candidate;
            }
        }
    }
    return undefined;
}

export async function detectProvider(provider: AiProviderDefinition): Promise<ProviderDetection> {
    const configured = vscode.workspace
        .getConfiguration('axis-share')
        .get<string>(providerPathSetting(provider.id), '')
        .trim();

    if (configured.length > 0) {
        const resolved = path.isAbsolute(configured) ? configured : path.resolve(configured);
        if (await isRegularFile(resolved)) {
            return {
                id: provider.id,
                displayName: provider.displayName,
                command: provider.command,
                installed: true,
                executablePath: resolved
            };
        }

        return {
            id: provider.id,
            displayName: provider.displayName,
            command: provider.command,
            installed: false,
            error: `설정한 경로를 찾을 수 없습니다: ${configured}`
        };
    }

    const found = await findExecutableInPath(provider.command, process.env.PATH);
    return {
        id: provider.id,
        displayName: provider.displayName,
        command: provider.command,
        installed: found !== undefined,
        executablePath: found,
        error: found === undefined ? `${provider.command} 명령을 PATH 에서 찾지 못했습니다.` : undefined
    };
}

export async function detectProviders(): Promise<ProviderDetection[]> {
    return Promise.all(AI_PROVIDERS.map((provider) => detectProvider(provider)));
}

export function detectionFor(providers: readonly ProviderDetection[], id: AiProviderId): ProviderDetection | undefined {
    return providers.find((provider) => provider.id === id);
}
