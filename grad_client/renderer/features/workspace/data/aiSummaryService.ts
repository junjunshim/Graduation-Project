import {
  getStoredAiApiKeys,
  getStoredAiPerformanceLevel,
  getStoredAiProviderOrder,
  type AiPerformanceLevel,
  type AiProvider,
} from '../../account/data/aiApiKeyService'

export type AiPromptType = 'file' | 'work_item' | 'user'

export interface SummarizeFileParams {
  fileName: string
  content: string
  sourceLabel?: string
  onProgress?: (step: string, percent?: number) => void
  onModelSelected?: (modelName: string) => void
}

export interface AiSummaryResult {
  success: boolean
  summary: string
  providerName: string
  modelName: string
  error?: string
}

/**
 * 파일 확장자 및 파일명을 기반으로 한 프롬프트 생성
 */
function buildFileSummaryPrompt(params: SummarizeFileParams): { systemPrompt: string; userPrompt: string } {
  const { fileName, content, sourceLabel } = params
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''

  const systemPrompt = `당신은 협업 플랫폼의 지능형 문서 및 코드 분석 전문가입니다.
사용자가 제공한 파일의 이름, 확장자, 텍스트 본문을 분석하여 그 성격에 가장 적합한 마크다운(Markdown) 보고서 형태로 요약하십시오.

[분류 및 요약 기준 지침]
1. 코딩/소스코드 관련 파일 (.js, .ts, .tsx, .py, .java, .cpp, .c, .go, .rs, .html, .css, .sql, .sh, .bat 등):
   - 📌 코드 목적 및 개요: 이 파일이 수행하는 핵심 역할
   - ⚙️ 주요 컴포넌트/함수/로직: 핵심 클래스, 함수, 상태, 또는 API 상호작용
   - 💡 특징 및 의존성: 사용된 주요 라이브러리, 알고리즘, 디자인 패턴
   - 🔍 코드 개선 또는 주의점: 가독성, 예외 처리, 유지보수 측면의 간략한 의견

2. 회의록/업무 메모/기획서/일정 관련 파일 (파일명에 '회의', '미팅', 'meeting', 'minutes', 'spec', '기획', '보고', '계획' 등이 포함되거나 .md, .txt 형태):
   - 📌 개요 및 목적: 일시, 참석자, 주요 안건 및 배경
   - 🗣️ 핵심 논의 내용: 주요 안건별 핵심 논의 사항 요약
   - 🤝 도출된 결론 및 결정사항: 합의된 결정 사항
   - ✅ 조치사항 (Action Items): 담당자별 할 일 및 일정

3. 설정/데이터 파일 (.json, .yaml, .yml, .env, .csv, .toml, .xml 등):
   - 📌 데이터/설정 목적: 무엇을 정의하거나 저장하는지
   - 🔑 주요 설정 항목 및 구조 설명
   - ⚠️ 설정 시 유의사항이나 제약조건

4. 그 외 일반 문서:
   - 📌 3줄 핵심 요약
   - 📝 본문 주요 내용 구조화 (불릿 포인트)
   - 💡 핵심 시사점 및 키워드

응답은 항상 친절하고 가독성이 뛰어난 한국어 마크다운(Markdown) 형식으로 작성하십시오.

[작성 시 필수 엄수 사항]
- 본 요약은 단발성 정적 분석 보고서입니다. 대화형 챗봇 스타일의 인사말, 서두, 맺음말(예: "추가로 필요하신 사항이 있다면 말씀해 주세요", "언제든지 질문해 주세요", "도움이 되셨기를 바랍니다" 등)은 절대로 포함하지 마십시오.
- 오직 마크다운으로 구조화된 분석 내용 보고서만 출력하십시오.`

  // 토큰 절약을 위해 너무 긴 파일은 상위 약 30,000자(약 7,000~8,000 토큰)로 제한
  const truncatedContent =
    content.length > 30000
      ? content.slice(0, 30000) + '\n\n...(본문이 길어 앞부분 30,000자만 전달되었습니다)...'
      : content

  const userPrompt = `다음 파일의 내용을 분석하고 정적 보고서 형식에 맞춰 요약해 주세요. 대화형 인사말이나 추가 질문 유도 멘트는 제외하십시오.

- 파일명: ${fileName}
- 파일 확장자: ${ext || '확장자 없음'}
${sourceLabel ? `- 출처: ${sourceLabel}` : ''}

[파일 본문]
\`\`\`${ext}
${truncatedContent}
\`\`\``

  return { systemPrompt, userPrompt }
}

/**
 * 챗봇형 대화 마무리 문구(예: "추가로 필요하신 사항이 있다면...", "언제든지 말씀해 주세요" 등)를 후처리로 제거합니다.
 */
function cleanSummaryOutput(text: string): string {
  if (!text) return ''

  // 후미에 오는 상투적 대화형 맺음말 패턴 제거
  const conversationalEndings = [
    /\n*(?:---+|\*\*\*+)?\s*(?:추가로|더|궁금하신|필요하신|다른|질문이나|도움이|언제든지|추가적인)[\s\S]{0,150}(?:말씀해\s*주세요|알려주세요|질문해\s*주세요|바랍니다|도와드리겠습니다|문의해\s*주세요)[.!\s]*$/i,
    /\n*(?:---+|\*\*\*+)?\s*(?:도움이\s*되셨기를\s*바랍니다|좋은\s*하루\s*되세요|감사합니다)[.!\s]*$/i,
  ]

  let cleaned = text.trim()
  for (const pattern of conversationalEndings) {
    cleaned = cleaned.replace(pattern, '').trim()
  }

  return cleaned
}

/**
 * 활성화된 AI API 키와 모델을 반환합니다.
 * 사용자가 설정한 우선순위(provider order)에 따라 첫 번째로 등록된 키를 선택합니다.
 */
export function getActiveAiProvider(): { provider: AiProvider; apiKey: string; modelName: string; baseUrl?: string } | null {
  const keys = getStoredAiApiKeys()
  const order = getStoredAiProviderOrder()

  for (const providerId of order) {
    const record = keys[providerId]
    if (record?.apiKey && record.apiKey.trim()) {
      return {
        provider: providerId,
        apiKey: record.apiKey.trim(),
        modelName: record.modelName?.trim() || '',
        baseUrl: record.baseUrl?.trim(),
      }
    }
  }

  return null
}

/**
 * Gemini에서 현재 API 키로 사용 가능한 `generateContent` 지원 모델 목록을 동적으로 가져옵니다.
 */
async function fetchSupportedGeminiModels(apiKey: string): Promise<string[]> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  try {
    const res = await fetch(url, { method: 'GET', signal: controller.signal })
    clearTimeout(timeoutId)

    if (!res.ok) {
      const errText = await res.text()
      let msg = `HTTP ${res.status}`
      try {
        const parsed = JSON.parse(errText)
        if (parsed.error?.message) msg = parsed.error.message
      } catch {
        msg = errText
      }
      throw new Error(`Google Gemini 모델 목록 조회 실패 (${msg})`)
    }

    const data = await res.json()
    if (!Array.isArray(data.models)) return []

    // generateContent를 지원하는 모델만 필터링
    const supported = data.models
      .filter((m: { supportedGenerationMethods?: string[] }) =>
        Array.isArray(m.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'),
      )
      .map((m: { name?: string }) => m.name)
      .filter((name?: string): name is string => Boolean(name))

    // 'models/gemini-...' 형태에서 models/ 접두사 제거한 순수 모델명 추출
    // 'models/gemini-...' 형태에서 models/ 접두사 제거한 순수 모델명 추출
    // 일반 텍스트 분석/대화가 가능한 gemini 계열 모델만 엄선 (deep-research, antigravity, aqa, embedding, tts 등 제외)
    const cleanNames = supported
      .map((name: string) => name.replace(/^models\//, ''))
      .filter((name: string) => {
        const lower = name.toLowerCase()
        return (
          lower.startsWith('gemini') &&
          !lower.includes('embedding') &&
          !lower.includes('aqa') &&
          !lower.includes('tts') &&
          !lower.includes('stt') &&
          !lower.includes('deep-research') &&
          !lower.includes('antigravity')
        )
      })

    return cleanNames
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error('Google Gemini 모델 목록 조회 시간 초과 (네트워크 연결을 확인해 주세요).')
    }
    throw err
  }
}

/**
 * Gemini 모델명에서 버전 및 등급 가중치 계산 (최신/고성능 내림차순 정렬용)
 */
function getGeminiModelScore(modelName: string): number {
  const lower = modelName.toLowerCase()
  let score = 0

  // 1. 버전 파싱 (예: 2.5, 2.0, 1.5, 1.0, 4.0 등)
  const versionMatch = lower.match(/gemini-(\d+(?:\.\d+)?)/)
  if (versionMatch) {
    score += parseFloat(versionMatch[1]) * 100
  } else {
    const numMatch = lower.match(/(\d+(?:\.\d+)?)/)
    if (numMatch) score += parseFloat(numMatch[1]) * 10
  }

  // 2. 등급 가중치 (Pro > Flash > Flash-Lite)
  if (lower.includes('pro')) {
    score += 50
  } else if (lower.includes('flash') && !lower.includes('lite')) {
    score += 30
  } else if (lower.includes('lite') || lower.includes('nano')) {
    score += 10
  }

  // preview/experimental 모델보다 안정화된 최신 정식/latest 모델 선호
  if (lower.includes('latest')) {
    score += 5
  }

  return score
}

/**
 * Gemini REST API 호출
 * ListModels를 통해 최신 버전 순으로 정렬 후, 사용자의 5단계 설정에 맞춰 최적 모델을 선택하여 호출합니다.
 */
async function callGeminiApi(
  apiKey: string,
  modelName: string,
  perfLevel: AiPerformanceLevel,
  systemPrompt: string,
  userPrompt: string,
  onModelSelected?: (modelName: string) => void,
  onProgress?: (step: string, percent?: number) => void,
): Promise<{ summary: string; actualModel: string }> {
  onProgress?.('API 키가 지원하는 최신 모델 목록 조회 중...', 20)
  // 1. 해당 API 키에서 사용 가능한 모델 목록 동적 조회
  const availableModels = await fetchSupportedGeminiModels(apiKey)

  if (availableModels.length === 0) {
    throw new Error(
      '해당 Gemini API 키에서 콘텐츠 생성(generateContent)을 지원하는 활성 모델을 찾을 수 없습니다. Google AI Studio에서 API 키 권한을 확인해 주세요.',
    )
  }

  // 2. 버전 및 성능 점수 기준 내림차순(최신/최고성능 우선) 정렬
  const sortedModels = [...availableModels].sort((a, b) => getGeminiModelScore(b) - getGeminiModelScore(a))

  // 3. 5단계 설정에 따른 '최적의 단일 모델' 1개 결정
  let targetModel = ''

  // 사용자가 명시적으로 지정한 모델명이 있을 경우 우선
  if (modelName?.trim()) {
    const clean = modelName.trim().replace(/^models\//, '')
    if (availableModels.includes(clean)) {
      targetModel = clean
    }
  }

  if (!targetModel) {
    if (perfLevel === 5) {
      // 5단계: 최상위 고성능 모델 (Pro 계열 최상위 -> 없으면 sortedModels[0])
      const pro = sortedModels.find((m) => m.toLowerCase().includes('pro'))
      targetModel = pro || sortedModels[0]
    } else if (perfLevel === 4) {
      // 4단계: Pro 계열 모델
      const pro = sortedModels.find((m) => m.toLowerCase().includes('pro'))
      targetModel = pro || sortedModels[0]
    } else if (perfLevel === 3) {
      // 3단계: 표준 모델 (Flash 또는 Thinking)
      const standard = sortedModels.find((m) => m.toLowerCase().includes('flash') && !m.toLowerCase().includes('lite'))
      targetModel = standard || sortedModels[0]
    } else if (perfLevel === 2) {
      // 2단계: 빠른 Flash 모델
      const flash = sortedModels.find((m) => m.toLowerCase().includes('flash'))
      targetModel = flash || sortedModels[0]
    } else {
      // 1단계: 초경량(Lite/Nano) 모델
      const lite = sortedModels.find(
        (m) => m.toLowerCase().includes('lite') || m.toLowerCase().includes('8b') || m.toLowerCase().includes('nano'),
      )
      targetModel = lite || sortedModels[sortedModels.length - 1]
    }
  }

  // 선택된 단일 모델 확정 및 알림
  onModelSelected?.(targetModel)
  onProgress?.(`선택된 모델 [${targetModel}]로 심층 분석 중...`, 50)

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent?key=${apiKey}`
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 30000)

  try {
    const response = await fetch(url, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: systemPrompt }],
        },
        contents: [
          {
            role: 'user',
            parts: [{ text: userPrompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
        },
      }),
    })

    clearTimeout(timeoutId)

    if (response.ok) {
      onProgress?.(`[${targetModel}] 분석 완료, 최종 요약 보고서 정리 중...`, 95)
      const data = await response.json()
      const candidate = data.candidates?.[0]?.content?.parts?.[0]?.text
      if (candidate) {
        return { summary: candidate, actualModel: targetModel }
      }
      throw new Error(`[${targetModel}] 유효한 텍스트 응답을 받지 못했습니다.`)
    } else {
      const errorBody = await response.text()
      let errorMsg = `HTTP ${response.status}`
      try {
        const parsed = JSON.parse(errorBody)
        if (parsed.error?.message) {
          errorMsg = parsed.error.message
        }
      } catch {
        errorMsg = errorBody.slice(0, 200)
      }
      throw new Error(`Google Gemini [${targetModel}] 요청 실패: ${errorMsg}`)
    }
  } catch (err) {
    clearTimeout(timeoutId)
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new Error(`Google Gemini [${targetModel}] 요청 시간 초과 (30초)`)
    }
    throw err
  }
}

/**
 * OpenAI REST API 호출
 */
async function callOpenAiApi(
  apiKey: string,
  modelName: string,
  perfLevel: AiPerformanceLevel,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ summary: string; actualModel: string }> {
  // 5단계에 따른 OpenAI 모델 매핑
  let model = modelName || 'gpt-4o'
  if (!modelName) {
    if (perfLevel >= 4) {
      model = 'gpt-4o'
    } else if (perfLevel === 3) {
      model = 'gpt-4o'
    } else {
      model = 'gpt-4o-mini'
    }
  }

  const url = 'https://api.openai.com/v1/chat/completions'

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    let errorMsg = `OpenAI 요청 실패 (HTTP ${response.status})`
    try {
      const parsed = JSON.parse(errorBody)
      if (parsed.error?.message) {
        errorMsg = parsed.error.message
      }
    } catch {
      // ignore
    }
    throw new Error(errorMsg)
  }

  const data = await response.json()
  const candidate = data.choices?.[0]?.message?.content
  if (!candidate) {
    throw new Error('OpenAI로부터 유효한 요약 결과를 받지 못했습니다.')
  }
  return { summary: candidate, actualModel: model }
}

/**
 * 파일 요약 AI 호출
 */
export async function summarizeFileWithAi(params: SummarizeFileParams): Promise<AiSummaryResult> {
  const active = getActiveAiProvider()
  if (!active) {
    return {
      success: false,
      summary: '',
      providerName: '',
      modelName: '',
      error: '등록된 AI API 키가 없습니다. 사용자 메뉴의 [AI API 키 설정]에서 키를 등록해 주세요.',
    }
  }

  const perfLevel = getStoredAiPerformanceLevel()
  const { systemPrompt, userPrompt } = buildFileSummaryPrompt(params)

  let actualSelectedModel = active.modelName

  try {
    let summaryText = ''

    if (active.provider === 'gemini') {
      const res = await callGeminiApi(
        active.apiKey,
        active.modelName,
        perfLevel,
        systemPrompt,
        userPrompt,
        (model) => {
          actualSelectedModel = `${model} (${perfLevel}단계)`
          params.onModelSelected?.(model)
        },
        params.onProgress,
      )
      summaryText = res.summary
      actualSelectedModel = `${res.actualModel} (${perfLevel}단계)`
    } else if (active.provider === 'openai') {
      actualSelectedModel = `${active.modelName || 'gpt-4o'} (${perfLevel}단계)`
      params.onProgress?.(`선택된 모델 [${active.modelName || 'gpt-4o'}]로 심층 분석 중...`, 50)
      params.onModelSelected?.(active.modelName || 'gpt-4o')
      const res = await callOpenAiApi(active.apiKey, active.modelName, perfLevel, systemPrompt, userPrompt)
      summaryText = res.summary
    } else {
      actualSelectedModel = `${active.modelName || 'custom'} (${perfLevel}단계)`
      params.onProgress?.(`선택된 모델 [${active.modelName || 'custom'}]로 심층 분석 중...`, 50)
      params.onModelSelected?.(active.modelName || 'custom')
      const res = await callOpenAiApi(active.apiKey, active.modelName, perfLevel, systemPrompt, userPrompt)
      summaryText = res.summary
    }

    return {
      success: true,
      summary: cleanSummaryOutput(summaryText),
      providerName: active.provider.toUpperCase(),
      modelName: actualSelectedModel,
    }
  } catch (err) {
    return {
      success: false,
      summary: '',
      providerName: active.provider.toUpperCase(),
      modelName: actualSelectedModel || active.modelName || '',
      error: err instanceof Error ? err.message : 'AI 요약 생성 중 오류가 발생했습니다.',
    }
  }
}
