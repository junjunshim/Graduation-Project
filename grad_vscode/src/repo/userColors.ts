import * as vscode from 'vscode';

/**
 * [TASK_11 §15.8] 사용자 색 배정.
 *
 * 색을 코드에 직접 넣지 않는다. `package.json` 의 `contributes.colors` 에 등록된
 * `axis-share.user.0 … .7` 을 `ThemeColor` 로 참조한다 — 등록된 색 id 만 `ThemeColor` 로 쓸 수 있고,
 * 이렇게 하면 라이트/다크/고대비 대응이 자동으로 따라온다.
 *
 * 배정은 `hash(email) % 8` 로 **결정적**이다. 접속 순서로 배정하면 누가 나갔을 때 남은 사람 색이
 * 밀려서 같은 사람이 다른 색으로 보인다(§8.10).
 * 사이드바 점(§15.5)과 에디터 원격 커서(§9.7)가 같은 함수를 쓰므로 두 화면 색이 항상 일치한다.
 */

/** 등록된 사용자 색 개수(`axis-share.user.0 … 7`). */
export const USER_COLOR_COUNT = 8;

/** 사용자 색 인덱스. 같은 이메일이면 언제나 같은 값이다. */
export function userColorIndex(email: string): number {
    // FNV-1a 32비트. 짧고 분산이 고르며 자릿수 문제(부동소수)가 없다.
    let hash = 0x811c9dc5;
    for (let index = 0; index < email.length; index += 1) {
        hash ^= email.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
    }

    return hash % USER_COLOR_COUNT;
}

/** 색 id(`axis-share.user.N`). 다른 모듈이 문자열로 필요할 때 쓴다. */
export function userColorId(email: string): string {
    return `axis-share.user.${userColorIndex(email)}`;
}

/** 사용자 색. 사이드바 점·원격 커서가 이 값을 그대로 쓴다. */
export function userColor(email: string): vscode.ThemeColor {
    return new vscode.ThemeColor(userColorId(email));
}

/**
 * 같은 색의 반투명 변형 id(`axis-share.user.N.sel`, 알파 30%).
 * `ThemeColor` 는 등록된 색 id 만 참조할 수 있고 알파를 코드에서 붙일 수 없어서, 선택 영역용으로 따로 등록해 둔다.
 */
export function userSelectionColorId(email: string): string {
    return `axis-share.user.${userColorIndex(email)}.sel`;
}

/**
 * 원격 선택 영역 배경색. 글자를 가리지 않도록 반투명이다 —
 * 커서 막대·이름표는 불투명 `userColor` 를 쓴다(§12.8).
 */
export function userSelectionColor(email: string): vscode.ThemeColor {
    return new vscode.ThemeColor(userSelectionColorId(email));
}
