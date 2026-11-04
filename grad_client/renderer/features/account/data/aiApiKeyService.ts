// 클라이언트 로컬(localStorage) 기반 AI API 키 보관소
// 나중에 AI 업무 요약, 파일 분석, 챗봇 등에서 이 서비스를 통해 API 키를 읽어 사용한다.

export type AiProvider = 'openai' | 'gemini' | 'anthropic' | 'custom'

/**
 * AI 모델 성능/성향 5단계
 * 1: 초고속/초경량 (Ultra Fast)
 * 2: 고속/표준 (Fast & Balanced)
 * 3: 균형/스마트 (Smart & Standard)
 * 4: 고성능/프로 (Pro & Analytical)
 * 5: 최고성능/플래그십 (Maximum / Flagship)
 */
export type AiPerformanceLevel = 1 | 2 | 3 | 4 | 5

export interface AiLevelInfo {
  level: AiPerformanceLevel
  title: string
  subtitle: string
  icon: string
}

export const AI_PERFORMANCE_LEVELS: AiLevelInfo[] = [
  { level: 1, title: '초경량', subtitle: '초고속 요약 (Flash-Lite / Nano)', icon: 'zap' },
  { level: 2, title: '고속', subtitle: '빠른 속도와 표준 품질 (Flash / Mini)', icon: 'trendingUp' },
  { level: 3, title: '스마트', subtitle: '균형 잡힌 범용 분석 (Standard / Thinking)', icon: 'cube' },
  { level: 4, title: '프로', subtitle: '정밀 분석 및 긴 문서 (Pro / Sonnet)', icon: 'star' },
  { level: 5, title: '플래그십', subtitle: '최상위 모델 최고 품질 (Flagship / Ultra)', icon: 'sparkles' },
]

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
const LOCAL_STORAGE_AI_ORDER = 'grad_ai_provider_order'
const LOCAL_STORAGE_AI_LEVEL = 'grad_ai_performance_level'

export function getStoredAiPerformanceLevel(): AiPerformanceLevel {
  if (typeof window === 'undefined' || !window.localStorage) return 5
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_AI_LEVEL)
    if (!raw) return 5
    const parsed = Number(raw) as AiPerformanceLevel
    if (parsed >= 1 && parsed <= 5) return parsed
    return 5
  } catch {
    return 5
  }
}

export function saveStoredAiPerformanceLevel(level: AiPerformanceLevel) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(LOCAL_STORAGE_AI_LEVEL, String(level))
    window.dispatchEvent(new CustomEvent('grad-ai-api-keys-updated', { detail: { level } }))
  } catch {
    // ignore
  }
}

export const DEFAULT_PROVIDER_ORDER: AiProvider[] = ['gemini', 'openai', 'anthropic', 'custom']

export function getStoredAiProviderOrder(): AiProvider[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return [...DEFAULT_PROVIDER_ORDER]
  }
  try {
    const raw = window.localStorage.getItem(LOCAL_STORAGE_AI_ORDER)
    if (!raw) return [...DEFAULT_PROVIDER_ORDER]
    const parsed = JSON.parse(raw) as AiProvider[]
    if (Array.isArray(parsed) && parsed.length > 0) {
      // 누락된 프로바이더가 있다면 뒤에 추가
      const result = [...parsed]
      for (const p of DEFAULT_PROVIDER_ORDER) {
        if (!result.includes(p)) {
          result.push(p)
        }
      }
      return result
    }
    return [...DEFAULT_PROVIDER_ORDER]
  } catch {
    return [...DEFAULT_PROVIDER_ORDER]
  }
}

export function saveStoredAiProviderOrder(order: AiProvider[]) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(LOCAL_STORAGE_AI_ORDER, JSON.stringify(order))
    window.dispatchEvent(new CustomEvent('grad-ai-api-keys-updated', { detail: { order } }))
  } catch {
    // ignore
  }
}

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
