/**
 * [TASK_11 §12.6 / §12.7] 텍스트 정규화·오프셋·최소 diff 유틸.
 *
 * Yjs 텍스트는 LF 로 고정한다(§9.4). 원본 파일의 CRLF 는 worktree 로 내려쓸 때(서버 flush)와
 * 확장의 로컬 사본을 쓸 때만 되돌린다. 그래서 에디터(원본 오프셋)와 Yjs(LF 오프셋) 사이를
 * 오가는 변환이 필요하다 — 문서 본문을 만지는 모듈이 여럿이라(문서 소켓·커서) 여기 모아 둔다.
 *
 * 정규화는 `\r\n` 만 `\n` 으로 바꾼다. 홑 `\r`(고전 Mac)은 그대로 둔다 — VS Code 의 텍스트
 * 모델이 줄바꿈을 문서 EOL 하나로 정규화하므로 실제로 나오지 않고, 남겨 두면 오프셋 변환이
 * 1:1 로 유지되어 단순해진다.
 */

/** 줄바꿈 정규화. Yjs 로 넣는 텍스트는 항상 이 값을 쓴다. */
export function normalizeEol(text: string): string {
    return text.includes('\r\n') ? text.replace(/\r\n/g, '\n') : text;
}

/** LF 정규화 오프셋을 원본(CRLF 가능) 오프셋으로 되돌린다 — `\r\n` 하나가 정규화에서 한 글자다. */
export function toRawOffset(raw: string, normalizedOffset: number): number {
    if (!raw.includes('\r')) {
        return normalizedOffset;
    }

    let rawIndex = 0;
    for (let count = 0; count < normalizedOffset; count += 1) {
        rawIndex += raw.charCodeAt(rawIndex) === 13 && raw.charCodeAt(rawIndex + 1) === 10 ? 2 : 1;
    }

    return rawIndex;
}

/**
 * 원본 오프셋을 LF 정규화 오프셋으로 바꾼다(`toRawOffset` 의 역방향).
 * `\r` 과 `\n` 사이(존재할 수 없는 커서 위치)는 줄 끝으로 본다.
 */
export function toNormalizedOffset(raw: string, rawOffset: number): number {
    if (!raw.includes('\r')) {
        return rawOffset;
    }

    let normalized = 0;
    let rawIndex = 0;
    while (rawIndex < rawOffset) {
        rawIndex += raw.charCodeAt(rawIndex) === 13 && raw.charCodeAt(rawIndex + 1) === 10 ? 2 : 1;
        normalized += 1;
    }

    return rawIndex > rawOffset ? normalized - 1 : normalized;
}

/**
 * 두 문자열의 최소 교체 구간을 찾는다(§12.7 최소 범위 diff).
 * 앞뒤로 같은 부분을 걷어내고 가운데만 바꾼다 — 전체 교체보다 커서가 덜 흔들린다.
 */
export function diffRange(current: string, target: string): { index: number; remove: number; insert: string } {
    const maxPrefix = Math.min(current.length, target.length);
    let prefix = 0;
    while (prefix < maxPrefix && current.charCodeAt(prefix) === target.charCodeAt(prefix)) {
        prefix += 1;
    }

    const maxSuffix = Math.min(current.length - prefix, target.length - prefix);
    let suffix = 0;
    while (
        suffix < maxSuffix &&
        current.charCodeAt(current.length - 1 - suffix) === target.charCodeAt(target.length - 1 - suffix)
    ) {
        suffix += 1;
    }

    return {
        index: prefix,
        remove: current.length - prefix - suffix,
        insert: target.slice(prefix, target.length - suffix)
    };
}
