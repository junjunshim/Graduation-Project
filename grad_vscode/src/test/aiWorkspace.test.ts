import * as assert from 'assert';

import {
    isSafeAiWorkspacePath,
    isSensitiveAiWorkspacePath,
    shouldIgnoreAiWorkspacePath
} from '../ai/workspaceManager';

suite('Axis Share AI 작업공간 경로', () => {
    test('저장소 상대 경로만 허용한다', () => {
        assert.strictEqual(isSafeAiWorkspacePath('src/app.ts'), true);
        assert.strictEqual(isSafeAiWorkspacePath('docs/가이드.md'), true);
        assert.strictEqual(isSafeAiWorkspacePath('README.md'), true);

        assert.strictEqual(isSafeAiWorkspacePath(''), false);
        assert.strictEqual(isSafeAiWorkspacePath('/etc/passwd'), false);
        assert.strictEqual(isSafeAiWorkspacePath('../outside.txt'), false);
        assert.strictEqual(isSafeAiWorkspacePath('src/../../outside.txt'), false);
        assert.strictEqual(isSafeAiWorkspacePath('src\\app.ts'), false);
        assert.strictEqual(isSafeAiWorkspacePath('.git/config'), false);
    });

    test('자격 증명이 들어가기 쉬운 파일은 AI 작업공간에서 제외한다', () => {
        assert.strictEqual(isSensitiveAiWorkspacePath('.env'), true);
        assert.strictEqual(isSensitiveAiWorkspacePath('config/.env.production'), true);
        assert.strictEqual(isSensitiveAiWorkspacePath('.ssh/id_rsa'), true);
        assert.strictEqual(isSensitiveAiWorkspacePath('credentials.json'), true);
        assert.strictEqual(isSensitiveAiWorkspacePath('.npmrc'), true);

        assert.strictEqual(isSensitiveAiWorkspacePath('.env.example'), false);
        assert.strictEqual(isSensitiveAiWorkspacePath('src/app.ts'), false);
    });

    test('확장이 만든 설정과 Git 메타데이터는 자동 동기화에서 제외한다', () => {
        assert.strictEqual(shouldIgnoreAiWorkspacePath('.git/index'), true);
        assert.strictEqual(shouldIgnoreAiWorkspacePath('.axis/context.md'), true);
        assert.strictEqual(shouldIgnoreAiWorkspacePath('.codex/config.toml'), true);
        assert.strictEqual(shouldIgnoreAiWorkspacePath('.antigravity/mcp.json'), true);
        assert.strictEqual(shouldIgnoreAiWorkspacePath('.mcp.json'), true);
        assert.strictEqual(shouldIgnoreAiWorkspacePath('node_modules/pkg/index.js'), true);
        assert.strictEqual(shouldIgnoreAiWorkspacePath('.env.local'), true);

        assert.strictEqual(shouldIgnoreAiWorkspacePath('src/app.ts'), false);
        assert.strictEqual(shouldIgnoreAiWorkspacePath('.github/workflows/build.yml'), false);
        assert.strictEqual(shouldIgnoreAiWorkspacePath('.gitignore'), false);
    });
});
