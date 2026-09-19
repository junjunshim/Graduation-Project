// 한국어 조사 처리 헬퍼.
// 받침 유무에 따라 조사를 고르고, `을(를)` 같은 병기 표기를 없애기 위해 사용한다.

const HANGUL_FIRST = 0xac00
const HANGUL_LAST = 0xd7a3
const JONGSEONG_COUNT = 28
const RIEUL_JONGSEONG = 8

// 닫는 따옴표·괄호·문장부호·단위 기호는 받침 판별에서 제외한다.
const TRAILING_SYMBOLS = /[\s‘’'"()[\]{}<>.,!?%…·:;/\\|~-]/

function lastSyllable(text: string): number | null {
  let value = (text ?? '').trim()
  while (value.length > 0 && TRAILING_SYMBOLS.test(value[value.length - 1])) {
    value = value.slice(0, -1)
  }

  if (value.length === 0) {
    return null
  }

  const code = value.charCodeAt(value.length - 1)
  return code >= HANGUL_FIRST && code <= HANGUL_LAST ? code : null
}

/** 마지막 글자에 받침이 있으면 true. 한글이 아니면 받침이 없는 것으로 본다. */
export function hasBatchim(text: string): boolean {
  const syllable = lastSyllable(text)
  if (syllable === null) {
    return false
  }

  return (syllable - HANGUL_FIRST) % JONGSEONG_COUNT !== 0
}

export type JosaKind = '을/를' | '이/가' | '은/는' | '와/과' | '으로/로'

/** 단어에 맞는 조사를 반환한다. (예: josa('업무', '을/를') === '를') */
export function josa(word: string, kind: JosaKind): string {
  const batchim = hasBatchim(word)

  switch (kind) {
    case '을/를':
      return batchim ? '을' : '를'
    case '이/가':
      return batchim ? '이' : '가'
    case '은/는':
      return batchim ? '은' : '는'
    case '와/과':
      return batchim ? '과' : '와'
    case '으로/로': {
      if (!batchim) {
        return '로'
      }

      const syllable = lastSyllable(word)
      const jongseong = syllable === null ? 0 : (syllable - HANGUL_FIRST) % JONGSEONG_COUNT
      return jongseong === RIEUL_JONGSEONG ? '로' : '으로'
    }
    default:
      return ''
  }
}

/** 단어 뒤에 알맞은 조사를 붙여 반환한다. (예: withJosa('업무', '을/를') === '업무를') */
export function withJosa(word: string, kind: JosaKind): string {
  return `${word}${josa(word, kind)}`
}