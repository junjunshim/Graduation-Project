import * as vscode from 'vscode';

import { getControlState, onDidChangeControlState } from './controlSocket';
import { getDocConnection, listOpenDocs, onDidChangeDocConnection, onDidChangeOpenDocs } from './docSocket';
import { getSession, onDidChangeSession } from './repoSession';

/**
 * [TASK_11 §12.10, §9.8] 연결 상태 표시줄.
 *
 * 협업 연결이 끊기면 편집이 잠긴다(§12.10). 그 사실이 화면 어딘가에 남아 있어야 하므로 상태
 * 표시줄 한 곳에 모아 그린다 — 정상일 때는 아무것도 그리지 않는다(잡음 금지). 문서 소켓(편집)과
 * 제어 소켓(presence·브랜치 이벤트) 중 더 심각한 하나만 보여 준다.
 *
 * 복원한 편집 내용과 파일이 어긋나 **파일 내용으로** 열린 문서도 여기서 알린다(§9.3, P0907). 그
 * 사실은 한 번 뜨는 경고로 끝나지 않고, 열려 있는 동안 배지로 남는다.
 *
 * 매니페스트는 건드리지 않는다 — 커맨드 하나를 코드로만 등록해 이 항목의 클릭을 받는다.
 */
const COMMAND_ID = 'axis-share.connectionStatus';

/** 배지 색조. 경고는 노랑, 편집 잠금은 빨강이다. */
type Tone = 'none' | 'warning' | 'error';

/** 항목 하나를 그리고 톤에 맞는 배경색을 고른다. */
function show(item: vscode.StatusBarItem, text: string, tone: Tone, tooltip: string): void {
    item.text = text;
    item.tooltip = tooltip;
    item.backgroundColor =
        tone === 'error'
            ? new vscode.ThemeColor('statusBarItem.errorBackground')
            : tone === 'warning'
              ? new vscode.ThemeColor('statusBarItem.warningBackground')
              : undefined;
    item.show();
}

/** 세션·소켓 상태 변화를 구독해 배지를 다시 그린다. `activate` 에서 한 번 부른다. */
export function startConnectionStatus(context: vscode.ExtensionContext): void {
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    item.command = COMMAND_ID;

    const render = (): void => {
        if (!getSession()) {
            item.hide(); // 앱에서 연결하기 전에는 알릴 것이 없다(§12.1).
            return;
        }

        const doc = getDocConnection();
        if (doc === 'locked') {
            show(
                item,
                '$(lock) Axis Share: 편집 잠금 — 협업 연결 끊김',
                'error',
                '협업 서버 연결이 끊어져 편집을 잠갔습니다. 다시 연결되면 서버 내용으로 맞춥니다(§12.10).'
            );
            return;
        }

        if (doc === 'reconnecting') {
            show(
                item,
                '$(debug-disconnect) Axis Share: 협업 연결 끊김 — 재연결 중',
                'warning',
                '협업 서버와 다시 연결하는 중입니다. 연결되면 열려 있던 파일을 서버 내용으로 맞춥니다(§12.10).'
            );
            return;
        }

        if (doc === 'joining') {
            show(item, '$(sync~spin) Axis Share: 협업 연결 중', 'none', '협업 서버 방에 들어가는 중입니다.');
            return;
        }

        const control = getControlState();
        if (control === 'authenticating' || control === 'joining') {
            show(item, '$(sync~spin) Axis Share: 연결 중', 'none', '제어 소켓에 연결하는 중입니다.');
            return;
        }

        if (control !== 'joined') {
            show(
                item,
                '$(warning) Axis Share: 제어 연결 끊김',
                'warning',
                'presence·브랜치 이벤트가 멈춥니다. 브랜치 전환·삭제는 다시 연결된 뒤에 하세요(§12.10).'
            );
            return;
        }

        // 복원한 편집 내용과 파일이 어긋나 파일 기준으로 맞춘 문서가 있으면 열려 있는 동안 계속 알린다
        // (§9.3, P0907). 연결 상태보다는 급하지 않으므로 마지막에 본다 — 위 경고를 가리지 않는다.
        const mismatched = listOpenDocs().filter((doc) => doc.mismatch);
        if (mismatched.length > 0) {
            show(
                item,
                `$(warning) Axis Share: 파일 기준으로 열린 문서 ${mismatched.length}개`,
                'warning',
                `저장된 편집 내용과 파일이 달라 파일 내용으로 맞춘 문서입니다(§9.3):\n${mismatched
                    .map((doc) => doc.path)
                    .join('\n')}`
            );
            return;
        }

        item.hide(); // 둘 다 정상이다.
    };

    context.subscriptions.push(
        item,
        onDidChangeDocConnection(() => render()),
        onDidChangeControlState(() => render()),
        onDidChangeOpenDocs(() => render()),
        onDidChangeSession(() => render()),
        vscode.commands.registerCommand(COMMAND_ID, () => {
            void vscode.window.showInformationMessage(
                `Axis Share 연결 — 편집(문서 소켓): ${getDocConnection()}, 제어 소켓: ${getControlState()}`
            );
        })
    );

    render();
}