// 클라이언트 로컬(localStorage) 기반 AI API 키 보관소
// 나중에 AI 업무 요약, 파일 분석, 챗봇 등에서 이 서비스를 통해 API 키를 읽어 사용한다.

export type AiProvider = 'openai' | 'gemini' | 'anthropic' | 'custom'

export type AiApiKeyRecord = {
  provider: AiProvider
  name: string
  apiKey: string
  modelName?: string
  baseUrl?: string
  updatedAt: string
}

export const AI_PROVIDERS: Array<{ id: AiProvider; label: string; placeholder: string; defaultModel: string }> = [
  { id: 'openai', label: 'OpenAI (ChatGPT)', placeholder: 'sk-...', defaultModel: 'gpt-4o' },
  { id: 'gemini', label: 'Google Gemini', placeholder: 'AIzaSy...', defaultModel: 'gemini-1.5-pro' },
  { id: 'anthropic', label: 'Anthropic Claude', placeholder: 'sk-ant-...', defaultModel: 'claude-3-5-sonnet' },
  { id: 'custom', label: '기타 / 사용자 지정', placeholder: 'API Key 입력', defaultModel: '' },
]

const LOCAL_STORAGE_AI_KEYS = 'grad_ai_api_keys'

export function getStoredAiApiKeys(): Record<AiProvider, AiApiKeyRecord | undefined> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {
      openai: undefined,
      gemini: undefined,
      anthropic: undefined,
      custom: undefined,
    }
  }

  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_AI_KEYS)
    if (!raw) {
      return {
        openai: undefined,
        gemini: undefined,
        anthropic: undefined,
        custom: undefined,
      }
    }
    return JSON.parse(raw) as Record<AiProvider, AiApiKeyRecord | undefined>
  } catch {
    return {
      openai: undefined,
      gemini: undefined,
      anthropic: undefined,
      custom: undefined,
    }
  }
}

export function saveStoredAiApiKey(record: AiApiKeyRecord) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const current = getStoredAiApiKeys()
    current[record.provider] = record
    window.localStorage.setItem(LOCAL_STORAGE_AI_KEYS, JSON.stringify(current))
    window.dispatchEvent(new CustomEvent('grad-ai-api-keys-updated', { detail: { provider: record.provider } }))
  } catch {
    // ignore
  }
}

export function removeStoredAiApiKey(provider: AiProvider) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    const current = getStoredAiApiKeys()
    delete current[provider]
    window.localStorage.setItem(LOCAL_STORAGE_AI_KEYS, JSON.stringify(current))
    window.dispatchEvent(new CustomEvent('grad-ai-api-keys-updated', { detail: { provider } }))
  } catch {
    // ignore
  }
}

/** 키가 등록되어 있는지 여부와 일부 마스킹된 문자열 반환 */
export function maskApiKey(key: string): string {
  if (!key) return ''
  if (key.length <= 8) return '••••••••'
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`
}
