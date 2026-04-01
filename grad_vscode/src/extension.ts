import * as vscode from 'vscode';
import api from './api';
import { GradNodeProvider } from './nodeProvider';
import { LoginViewProvider } from './loginViewProvider';

export async function activate(context: vscode.ExtensionContext) {
    const gradNodeProvider = new GradNodeProvider();
    
    // 1. 사이드바 UI와 데이터 공급자 연결
    vscode.window.registerTreeDataProvider('grad-nodes-view', gradNodeProvider);

    // 2. 로그인용 웹뷰 공급자 등록
    const loginViewProvider = new LoginViewProvider(context.extensionUri);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('grad-login-view', loginViewProvider)
    );

    // 3. 내부 보안 저장소에서 토큰 읽기 명령 (api.ts에서 사용)
    vscode.commands.registerCommand('grad-vscode.getAccessToken', () => {
        return context.secrets.get('grad-at');
    });

    // 3. 로그인 명령
    vscode.commands.registerCommand('grad-vscode.loginAction', async (email, password) => {
        try {
            const res = await api.post('/users/login', { email, password });
            const { access_token, refresh_token } = res.data;

            await context.secrets.store('grad-at', access_token);
            await context.secrets.store('grad-rt', refresh_token);

            vscode.window.showInformationMessage('🎉 성공적으로 로그인되었습니다.');
            
            // 로그인 상태임을 VS Code에 알림 (UI 스위칭용)
            vscode.commands.executeCommand('setContext', 'grad:isLoggedIn', true);
            gradNodeProvider.refresh();
            vscode.commands.executeCommand('grad-nodes-view.focus');
        } catch (err: any) {
            vscode.window.showErrorMessage('로그인 실패: ' + (err.response?.data?.message || '서버 오류'));
        
            // [핵심] 웹뷰(HTML)에 로그인 실패를 알려서 버튼을 복구시킵니다.
            loginViewProvider.postMessageToWebview({ 
                command: 'loginFailed' 
            });
        }
    });

    // 4. 로그아웃 명령 (수정: Context 해제 추가)
    context.subscriptions.push(
        vscode.commands.registerCommand('grad-vscode.logout', async () => {
            const answer = await vscode.window.showInformationMessage(
                '로그아웃 하시겠습니까?',
                { modal: true },
                '예'
            );

            if (answer !== '예') return;

            await context.secrets.delete('grad-at');
            await context.secrets.store('grad-rt', '');

            // 로그아웃 상태임을 알림
            vscode.commands.executeCommand('setContext', 'grad:isLoggedIn', false);
            gradNodeProvider.refresh();
            vscode.commands.executeCommand('grad-login-view.focus');

            vscode.window.showInformationMessage('로그아웃 되었습니다.');
        })
    );

    // 5. 초기 구동 시 로그인 상태 체크 (자동 화면 전환)
    const savedToken = await context.secrets.get('grad-at');
    if (savedToken) {
        vscode.commands.executeCommand('setContext', 'grad:isLoggedIn', true);
    }

    // 5. 수동 새로고침 명령
    context.subscriptions.push(
        vscode.commands.registerCommand('grad-nodes-view.refreshEntry', () => gradNodeProvider.refresh())
    );
}