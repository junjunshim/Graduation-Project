import * as vscode from 'vscode';

export class LoginViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'grad-login-view';
    private _view?: vscode.WebviewView;

    // 1. extension.ts에서 보낸 extensionUri를 받기 위한 생성자 추가
    constructor(
        private readonly _extensionUri: vscode.Uri
    ) {}

    public postMessageToWebview(message: any) {
        if (this._view) {
            this._view.webview.postMessage(message);
        }
    }

    // 2. resolveWebviewView의 인자를 표준 인터페이스에 맞게 작성
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;
        
        webviewView.webview.options = { 
            enableScripts: true,
            // 로컬 리소스 사용 범위를 확장 프로그램 경로로 제한 (보안)
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = `
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <style>
                    /* VS Code 순정 사이드바 배경 및 폰트 설정 */
                    body {
                        padding: 12px; /* 네이티브 뷰 특유의 좁은 여백 */
                        color: var(--vscode-foreground);
                        font-family: var(--vscode-font-family);
                        font-size: var(--vscode-font-size);
                        background-color: var(--vscode-sideBar-background); /* 사이드바 전용 배경 */
                        display: flex;
                        flex-direction: column;
                        margin: 0;
                        overflow: hidden; /* 스크롤바 숨김 (필요시 제거) */
                    }

                    /* 큰 제목을 없애고 작은 설명 텍스트로 대체 (네이티브 느낌) */
                    .description {
                        font-size: 12px;
                        color: var(--vscode-descriptionForeground);
                        margin-bottom: 15px;
                        line-height: 1.4;
                    }

                    .input-container {
                        display: flex;
                        flex-direction: column;
                        gap: 6px; /* 입력창 사이 간격 타이트하게 */
                        margin-bottom: 12px;
                    }

                    /* [핵심] image_2.png의 SEARCH 입력창 스타일 완벽 이식 */
                    input {
                        background-color: var(--vscode-input-background);
                        color: var(--vscode-input-foreground);
                        border: 1px solid var(--vscode-input-border);
                        border-radius: 4px;
                        /* 높이를 아주 타이트하게 설정 */
                        height: 24px; 
                        padding: 0 6px; /* 좌우 여백 좁게 */
                        font-family: inherit;
                        font-size: inherit;
                        outline: none;
                        box-sizing: border-box; /* 패딩 포함 크기 계산 */
                    }

                    input:focus {
                        border-color: var(--vscode-focusBorder);
                    }

                    input::placeholder {
                        color: var(--vscode-input-placeholderForeground);
                        font-size: 13px; /* Placeholder 글자 크기 축소 */
                    }

                    /* [핵심] image_3.png의 버튼 스타일 완벽 이식 */
                    button {
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        border: none;
                        /* 버튼 높이는 입력창보다 살짝 높게 */
                        height: 26px;
                        padding: 0; /* 텍스트 정중앙 정렬을 위해 padding 제거 */
                        cursor: pointer;
                        font-family: inherit;
                        font-size: 11px;
                        font-weight: 400; /* 너무 굵지 않게 */
                        border-radius: 3px; /* 아주 미세한 라운드 */
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: background-color 0.1s;
                    }

                    button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }

                    button:focus {
                        outline: 1px solid var(--vscode-focusBorder);
                        outline-offset: 2px;
                    }
                </style>
            </head>
            <body>
                <div class="description">
                    In order to use Workflow features, <br/>you need to sign in
                </div>
                
                <div class="input-container">
                    <input type="email" id="email" placeholder="Email" spellcheck="false" />
                    <input type="password" id="password" placeholder="Password" />
                </div>

                <button id="loginBtn">Sign In</button>

                <script>
                    const vscode = acquireVsCodeApi();
                    const loginBtn = document.getElementById('loginBtn');
                    const emailInput = document.getElementById('email');
                    const passwordInput = document.getElementById('password');

                    // 로그인 시도 함수
                    function attemptLogin() {
                        if (loginBtn.disabled) return;

                        const email = emailInput.value;
                        const password = passwordInput.value;

                        if (!email || !password) return;

                        loginBtn.innerText = 'Connecting...';
                        loginBtn.disabled = true;

                        vscode.postMessage({ command: 'login', email, password });
                    }

                    loginBtn.addEventListener('click', attemptLogin);

                    // 엔터키 지원
                    [emailInput, passwordInput].forEach(input => {
                        input.addEventListener('keypress', (e) => {
                            if (e.key === 'Enter') attemptLogin();
                        });
                    });

                    // 실패 메시지 수신 시 복구
                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.command === 'loginFailed') {
                            loginBtn.innerText = 'Sign In';
                            loginBtn.disabled = false;
                            passwordInput.value = '';
                            passwordInput.focus();
                        }
                    });
                </script>
            </body>
            </html>
        `;

        // 3. HTML로부터 오는 메시지 수신 로직 (data.command 확인)
        webviewView.webview.onDidReceiveMessage(async (data) => {
            if (data.command === 'login') {
                // extension.ts에 등록된 실제 로그인 처리 커맨드 호출
                vscode.commands.executeCommand('grad-vscode.loginAction', data.email, data.password);
            }
        });
    }
}