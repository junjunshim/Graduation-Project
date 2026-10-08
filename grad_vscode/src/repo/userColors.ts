import * as vscode from 'vscode';

/**
 * [TASK_11 §15.8] 사용자 색 배정.
 *
 * 색을 코드에 직접 넣지 않는 것이 원칙이라, `package.json` 의 `contributes.colors` 에 등록한
 * `axis-share.user.0 … .7` 을 사이드바 점(`ThemeIcon`)에서 `ThemeColor` 로 참조한다 —
 * 그러면 라이트/다크/고대비 대응이 테마 정의를 따라간다.
 *
 * 배정은 `hash(email) % 8` 로 **결정적**이다. 접속 순서로 배정하면 누가 나갔을 때 남은 사람 색이
 * 밀려서 같은 사람이 다른 색으로 보인다(§8.10). 사이드바 점과 에디터 원격 커서가 같은 함수를 쓰므로
 * 두 화면의 색이 항상 일치한다.
 *
 * 에디터 데코레이션(커서 막대·이름표 배경·선택 영역)만은 등록 색 대신 **hex 를 직접 쓴다**.
 * 2026-10-09 확인: 확장이 등록한 색 id 는 데코레이션에서 해석되지 않아(내장 id 는 해석된다)
 * 커서·선택 영역·배지 배경이 전부 투명해졌다. 그래서 아래 `PALETTE` 가 `package.json` 과 같은 값을
 * 들고, 테마 종류를 직접 보고 고른다 — 데코레이션의 `light`/`dark` 오버라이드로는 고대비를 표현할 수 없다.
 * **두 곳의 값은 함께 고쳐야 한다.**
 */

/** 등록된 사용자 색 개수(`axis-share.user.0 … 7`). */
export const USER_COLOR_COUNT = 8;

/** 8색 팔레트. `package.json` 의 `axis-share.user.N` 기본값과 값이 같아야 한다. */
const PALETTE: readonly { readonly dark: string; readonly light: string; readonly contrast: string }[] = [
    { dark: '#e06c75', light: '#c62828', contrast: '#ff8b94' },
    { dark: '#e5c07b', light: '#9a6700', contrast: '#f0d38a' },
    { dark: '#98c379', light: '#2e7d32', contrast: '#a9d99a' },
    { dark: '#56b6c2', light: '#00695c', contrast: '#6fd0dc' },
    { dark: '#61afef', light: '#1565c0', contrast: '#7cc0ff' },
    { dark: '#c678dd', light: '#6a1b9a', contrast: '#d495ea' },
    { dark: '#ff8a65', light: '#d84315', contrast: '#ffa585' },
    { dark: '#9aa4b2', light: '#455a64', contrast: '#b6c0cc' }
];

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

/** 사용자 색 — 등록 색 참조. `ThemeColor` 만 받는 자리(사이드바 점)에 쓴다. */
export function userColor(email: string): vscode.ThemeColor {
    return new vscode.ThemeColor(userColorId(email));
}

/** 지금 테마에 맞는 사용자 색 hex. 에디터 커서 막대·이름표 배경이 쓴다. */
export function userColorHex(email: string): string {
    const entry = PALETTE[userColorIndex(email)];
    switch (vscode.window.activeColorTheme.kind) {
        case vscode.ColorThemeKind.Light:
            return entry.light;
        case vscode.ColorThemeKind.Dark:
            return entry.dark;
        default:
            return entry.contrast; // HighContrast / HighContrastLight 는 대비가 가장 센 색을 쓴다.
    }
}

/** 같은 색의 반투명(30%) 변형 — 원격 선택 영역 배경. 글자를 가리지 않는다. */
export function userSelectionHex(email: string): string {
    return `${userColorHex(email)}4D`;
}