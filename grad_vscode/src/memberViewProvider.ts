// MemberViewProvider.ts
import * as vscode from 'vscode';

export class MemberViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'grad-member-view';
    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    // Webview가 처음 로드될 때 호출
    public resolveWebviewView(webviewView: vscode.WebviewView) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);
    }

    // 트리에서 데이터를 받아 Webview로 전송하는 메서드
    public updateMemberList(nodeName: string, members: any[]) {
        if (this._view) {
            this._view.show?.(true); // 뷰를 강제로 활성화
            this._view.webview.postMessage({
                type: 'update',
                title: nodeName,
                data: members
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <style>
                    :root {
                        /* VS Code 공식 테마 변수 활용 */
                        --container-padding: 12px;
                        --list-hover-bg: var(--vscode-list-hoverBackground);
                        --divider: var(--vscode-divider);
                        --header-color: var(--vscode-foreground);
                        --secondary-text: var(--vscode-descriptionForeground);
                        
                        /* 아이콘 전용 색상 */
                        --icon-org: var(--vscode-symbolIcon-classForeground);     /* 조직/부서: 보라/파랑 계열 */
                        --icon-group: var(--vscode-symbolIcon-enumeratorForeground); /* 그룹: 주황/노랑 계열 */
                        --icon-user: var(--vscode-symbolIcon-userForeground, var(--vscode-descriptionForeground));
                    }

                    body { 
                        font-family: var(--vscode-font-family); 
                        font-size: var(--vscode-font-size);
                        color: var(--vscode-foreground); 
                        padding: var(--container-padding);
                        margin: 0;
                        user-select: none;
                    }

                    /* 상단 헤더: Organization 아이콘 적용 */
                    .header { 
                        display: flex;
                        align-items: center;
                        font-weight: 600;
                        font-size: 1.1rem;
                        margin-bottom: 16px;
                        padding-bottom: 12px;
                        border-bottom: 1px solid var(--divider);
                        color: var(--header-color);
                    }

                    /* SVG 공통 스타일 */
                    .vsc-icon {
                        flex-shrink: 0;
                        fill: currentColor;
                        display: inline-block;
                        vertical-align: middle;
                    }

                    .header-icon { 
                        width: 20px; 
                        height: 20px; 
                        margin-right: 10px;
                        color: var(--icon-org); 
                    }

                    /* 테이블 구조 */
                    table { width: 100%; border-collapse: collapse; }
                    th { 
                        text-align: left; 
                        padding: 8px; 
                        color: var(--secondary-text);
                        font-size: 0.7rem;
                        font-weight: 600;
                        text-transform: uppercase;
                        letter-spacing: 0.5px;
                        border-bottom: 1px solid var(--divider);
                    }
                    td { padding: 10px 8px; border-bottom: 1px solid var(--divider); }
                    tr:hover { background-color: var(--list-hover-bg); }

                    /* 멤버 셀: Account 아이콘 적용 */
                    .member-cell { 
                        display: flex; 
                        align-items: center; 
                        gap: 10px;
                    }
                    .member-icon { 
                        width: 16px; 
                        height: 16px; 
                        color: var(--icon-user);
                        opacity: 0.8;
                    }

                    /* 권한 배지 */
                    .status-badge {
                        display: inline-block;
                        padding: 2px 6px;
                        border-radius: 3px;
                        font-size: 0.7rem;
                        font-weight: 400;
                        background: var(--vscode-badge-background);
                        color: var(--vscode-badge-foreground);
                        border: 1px solid var(--vscode-contrastBorder, transparent);
                    }

                    .empty-state {
                        padding: 60px 20px;
                        text-align: center;
                        color: var(--secondary-text);
                    }
                    .empty-icon { width: 40px; height: 40px; margin-bottom: 12px; opacity: 0.3; }
                </style>
            </head>
            <body>
                <div class="header" id="header-container">
                    <svg class="vsc-icon header-icon" viewBox="0 0 16 16" id="main-icon">
                        <path d="M15 13V3l-1-1H2L1 3v10l1 1h12l1-1zM2 3h12v10H2V3zm10 8h1V4h-1v7zm-2 0h1V7h-1v4zm-2 0h1V4h-1v7zm-2 0h1V8H6v3zm-2 0h1V5H4v6z"/>
                    </svg>
                    <span id="node-title">Select a node</span>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>Member Name</th>
                            <th>Role / Status</th>
                        </tr>
                    </thead>
                    <tbody id="member-body">
                        <tr>
                            <td colspan="2" class="empty-state">
                                <svg class="vsc-icon empty-icon" viewBox="0 0 16 16"><path d="M15 8.545L11.545 12 15 15.455 14.455 16 11 12.545 7.545 16 7 15.455 10.455 12 7 8.545 7.545 8 11 11.455 14.455 8l.545.545zM11 1a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 1a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"/></svg>
                                <br>No node selected
                            </td>
                        </tr>
                    </tbody>
                </table>

                <script>
                    const titleElem = document.getElementById('node-title');
                    const bodyElem = document.getElementById('member-body');
                    const mainIcon = document.getElementById('main-icon');

                    // SVG Path 데이터 정의
                    const icons = {
                        org: 'M15 13V3l-1-1H2L1 3v10l1 1h12l1-1zM2 3h12v10H2V3zm10 8h1V4h-1v7zm-2 0h1V7h-1v4zm-2 0h1V4h-1v7zm-2 0h1V8H6v3zm-2 0h1V5H4v6z',
                        group: 'M13 14H3V7.5l.5-.5h2.7l.5.5V9h2.6V7.5l.5-.5h2.7l.5.5V14zM4 13h2V8H4v5zm5 0h2V8H9v5zM8 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0-1a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM3 6a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0-1a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm10 1a2 2 0 1 1 0-4 2 2 0 0 1 0 4zm0-1a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
                        account: 'M11 5c0 1.657-1.343 3-3 3S5 6.657 5 5s1.343-3 3-3 3 1.343 3 3zM8 7c1.105 0 2-.895 2-2s-.895-2-2-2-2 .895-2 2 .895 2 2 2zm6 7H2v-1.545C2 10.455 5 10 8 10s6 .455 6 2.455V14zm-1-1v-.545c0-1.127-2.308-1.455-5-1.455s-5 .328-5 1.455V13h10z'
                    };

                    window.addEventListener('message', event => {
                        const message = event.data;
                        if (message.type === 'update') {
                            titleElem.innerText = message.title;
                            
                            // 데이터 성격에 따라 헤더 아이콘 변경 (title에 'Department' 포함 여부 등 활용)
                            const isDept = message.title.includes('Department');
                            mainIcon.querySelector('path').setAttribute('d', isDept ? icons.group : icons.org);
                            mainIcon.style.color = isDept ? 'var(--icon-group)' : 'var(--icon-org)';

                            if (message.data && message.data.length > 0) {
                                bodyElem.innerHTML = message.data.map(m => \`
                                    <tr>
                                        <td>
                                            <div class="member-cell">
                                                <svg class="vsc-icon member-icon" viewBox="0 0 16 16"><path d="\${icons.account}"/></svg>
                                                <span>\${m.title}</span>
                                            </div>
                                        </td>
                                        <td><span class="status-badge">\${m.status || 'USER'}</span></td>
                                    </tr>
                                \`).join('');
                            } else {
                                bodyElem.innerHTML = '<tr><td colspan="2" class="empty-state">No members found</td></tr>';
                            }
                        }
                    });
                </script>
            </body>
            </html>`;
    }
}