import type { TodoItem } from './types'

const todoList: TodoItem[] = [
  {
    id: 'thesis-outline',
    title: '논문 개요 최종 정리',
    description: '지도교수 미팅 전에 서론, 연구 방법, 일정 요약을 한 문서로 정리합니다.',
    status: 'in-progress',
    dueDate: '2026-03-18',
  },
  {
    id: 'ui-main-page',
    title: '데스크탑 메인 페이지 UI 개편',
    description: '메인 화면을 워크스페이스 중심 구조로 재구성하고 공통 레이아웃 톤을 맞춥니다.',
    status: 'in-progress',
    dueDate: '2026-03-19',
  },
  {
    id: 'interview-script',
    title: '발표 리허설 질문 리스트 작성',
    description: '발표 중 받을 가능성이 높은 질문과 답변 포인트를 정리합니다.',
    status: 'planned',
    dueDate: '2026-03-21',
  },
  {
    id: 'advisor-checkin',
    title: '지도교수 체크인 안건 준비',
    description: '현재 진행률, 남은 리스크, 일정 변경 가능성을 요약한 메모를 준비합니다.',
    status: 'planned',
    dueDate: '2026-03-22',
  },
  {
    id: 'api-bridge-review',
    title: 'Electron IPC 구조 검토',
    description: 'renderer 와 preload 경계를 점검하고 필요한 통신 포인트를 문서화했습니다.',
    status: 'done',
    dueDate: '2026-03-16',
  },
  {
    id: 'demo-script',
    title: '데모 시나리오 초안 작성',
    description: '시연 순서와 전환 멘트를 정리한 발표 시나리오 초안을 완료했습니다.',
    status: 'done',
    dueDate: '2026-03-15',
  },
]

export function getTodos() {
  return todoList
}

export function getTodoById(id: string) {
  return todoList.find((todo) => todo.id === id)
}
