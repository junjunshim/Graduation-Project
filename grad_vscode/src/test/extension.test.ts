import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Axis Share 확장', () => {
    test('확장이 활성화되고 선언한 커맨드가 등록된다', async () => {
        const extension = vscode.extensions.getExtension('junjunshim.axis-share');
        assert.ok(extension, 'junjunshim.axis-share 확장을 찾을 수 없습니다.');

        await extension.activate();
        assert.strictEqual(extension.isActive, true);

        const registered = await vscode.commands.getCommands(true);
        assert.ok(registered.includes('axis-share.refresh'), 'axis-share.refresh 커맨드가 없습니다.');
        assert.ok(registered.includes('axis-share.switchBranch'), 'axis-share.switchBranch 커맨드가 없습니다.');
    });
});