import type {
  OrganizationNodeRecord,
  RoleAssignmentRecord,
  UserRecord,
  WorkItemRecord,
  WorkspaceDatabase,
} from '../model/types'

export const TEAM_404_DATASET_ID = 'team-404-workspace'
export const TEAM_404_SEED_VERSION = 20260322
export const TEAM_404_DEMO_USER_ID = 'U-1'

const TEAM_404_DEMO_PASSWORD = 'team404-demo'

function getSeedTimestamp(offsetDays = 0) {
  const base = new Date('2026-03-01T09:00:00+09:00')
  base.setDate(base.getDate() + offsetDays)
  return base.toISOString()
}

const team404SeedUsers: UserRecord[] = [
  {
    userId: 'U-1',
    email: 'backend.lead@team404.dev',
    name: '윤서준',
    password: TEAM_404_DEMO_PASSWORD,
    personalNodeId: 1,
    createdAt: getSeedTimestamp(0),
  },
  {
    userId: 'U-2',
    email: 'frontend.lead@team404.dev',
    name: '김채린',
    password: TEAM_404_DEMO_PASSWORD,
    personalNodeId: 2,
    createdAt: getSeedTimestamp(0),
  },
  {
    userId: 'U-3',
    email: 'frontend.ui@team404.dev',
    name: '박도현',
    password: TEAM_404_DEMO_PASSWORD,
    personalNodeId: 3,
    createdAt: getSeedTimestamp(1),
  },
  {
    userId: 'U-4',
    email: 'frontend.qa@team404.dev',
    name: '이서현',
    password: TEAM_404_DEMO_PASSWORD,
    personalNodeId: 4,
    createdAt: getSeedTimestamp(1),
  },
]

const team404SeedNodes: OrganizationNodeRecord[] = [
  { id: 1, nodeType: 'USER', name: '윤서준 개인공간', path: [1], createdAt: getSeedTimestamp(0) },
  { id: 2, nodeType: 'USER', name: '김채린 개인공간', path: [2], createdAt: getSeedTimestamp(0) },
  { id: 3, nodeType: 'USER', name: '박도현 개인공간', path: [3], createdAt: getSeedTimestamp(1) },
  { id: 4, nodeType: 'USER', name: '이서현 개인공간', path: [4], createdAt: getSeedTimestamp(1) },
  { id: 5, nodeType: 'TEAM', name: '404', path: [5], createdAt: getSeedTimestamp(2) },
  {
    id: 6,
    parentNodeId: 5,
    nodeType: 'PROJECT',
    name: '무한 확장형 조직 노드 기반 협업 시스템',
    path: [5, 6],
    createdAt: getSeedTimestamp(3),
  },
  {
    id: 7,
    parentNodeId: 6,
    nodeType: 'TEAM',
    name: '프론트엔드',
    path: [5, 6, 7],
    createdAt: getSeedTimestamp(4),
  },
  {
    id: 8,
    parentNodeId: 6,
    nodeType: 'TEAM',
    name: '백엔드',
    path: [5, 6, 8],
    createdAt: getSeedTimestamp(4),
  },
]

const team404SeedRoles: RoleAssignmentRecord[] = [
  { id: 1, userId: 'U-1', nodeId: 1, roleName: 'ADMIN', createdAt: getSeedTimestamp(0) },
  { id: 2, userId: 'U-2', nodeId: 2, roleName: 'ADMIN', createdAt: getSeedTimestamp(0) },
  { id: 3, userId: 'U-3', nodeId: 3, roleName: 'ADMIN', createdAt: getSeedTimestamp(1) },
  { id: 4, userId: 'U-4', nodeId: 4, roleName: 'ADMIN', createdAt: getSeedTimestamp(1) },
  { id: 5, userId: 'U-1', nodeId: 5, roleName: 'ADMIN', createdAt: getSeedTimestamp(2) },
  { id: 6, userId: 'U-2', nodeId: 5, roleName: 'MANAGER', createdAt: getSeedTimestamp(2) },
  { id: 7, userId: 'U-3', nodeId: 5, roleName: 'MEMBER', createdAt: getSeedTimestamp(2) },
  { id: 8, userId: 'U-4', nodeId: 5, roleName: 'MEMBER', createdAt: getSeedTimestamp(2) },
  { id: 9, userId: 'U-2', nodeId: 6, roleName: 'ADMIN', createdAt: getSeedTimestamp(3) },
  { id: 10, userId: 'U-2', nodeId: 7, roleName: 'ADMIN', createdAt: getSeedTimestamp(4) },
  { id: 11, userId: 'U-3', nodeId: 7, roleName: 'MEMBER', createdAt: getSeedTimestamp(4) },
  { id: 12, userId: 'U-4', nodeId: 7, roleName: 'MEMBER', createdAt: getSeedTimestamp(4) },
  { id: 13, userId: 'U-1', nodeId: 8, roleName: 'ADMIN', createdAt: getSeedTimestamp(4) },
]

const team404SeedWorkItems: WorkItemRecord[] = [
  {
    workItemId: 'WI-1',
    ownerNodeId: 5,
    ownerUserId: 'U-1',
    title: '2026 졸업작품 개발 일정',
    description: '팀 404의 설계, 구현, 검토, 데모 준비를 묶는 상위 일정입니다.',
    status: 'in-progress',
    priority: 1,
    weight: 5,
    progress: 58,
    startDate: '2026-03-03',
    dueDate: '2026-04-12',
    createdAt: getSeedTimestamp(5),
  },
  {
    workItemId: 'WI-2',
    ownerNodeId: 6,
    ownerUserId: 'U-2',
    title: '조직 관리 흐름 점검',
    description: '온보딩 이후 조직 생성, 역할 부여, 경로 표기를 하나의 시나리오로 검증합니다.',
    status: 'in-progress',
    priority: 1,
    weight: 2,
    progress: 64,
    startDate: '2026-03-12',
    dueDate: '2026-03-27',
    parentWorkItemId: 'WI-1',
    createdAt: getSeedTimestamp(6),
  },
  {
    workItemId: 'WI-3',
    ownerNodeId: 7,
    ownerUserId: 'U-2',
    title: '대시보드 UI 정교화',
    description: '워크스페이스 개요, 우선순위 업무, 팀 구성 정보가 한 화면에서 읽히도록 정리합니다.',
    status: 'in-progress',
    priority: 1,
    weight: 2,
    progress: 72,
    startDate: '2026-03-10',
    dueDate: '2026-03-26',
    parentWorkItemId: 'WI-1',
    createdAt: getSeedTimestamp(6),
  },
  {
    workItemId: 'WI-4',
    ownerNodeId: 7,
    ownerUserId: 'U-3',
    title: '업무 생성 폼 개선',
    description: '노드 선택, 담당자 지정, 상위 work item 연결 흐름을 실제 입력 순서에 맞게 다듬습니다.',
    status: 'todo',
    priority: 2,
    weight: 1,
    progress: 0,
    startDate: '2026-03-18',
    dueDate: '2026-03-30',
    parentWorkItemId: 'WI-1',
    createdAt: getSeedTimestamp(7),
  },
  {
    workItemId: 'WI-5',
    ownerNodeId: 7,
    ownerUserId: 'U-4',
    title: 'mock 데이터 구조 정비',
    description: '홈, 조직, 대시보드 화면에서 일관되게 보이는 팀 404 기준 샘플 데이터를 정리했습니다.',
    status: 'done',
    priority: 2,
    weight: 1,
    progress: 100,
    startDate: '2026-03-14',
    dueDate: '2026-03-31',
    parentWorkItemId: 'WI-1',
    createdAt: getSeedTimestamp(7),
  },
  {
    workItemId: 'WI-6',
    ownerNodeId: 8,
    ownerUserId: 'U-1',
    title: 'API/스키마 정리',
    description: '조직 노드, 권한, work item API 응답 구조를 문서와 mock 데이터 기준으로 맞춥니다.',
    status: 'in-progress',
    priority: 1,
    weight: 2,
    progress: 51,
    startDate: '2026-03-11',
    dueDate: '2026-03-28',
    parentWorkItemId: 'WI-1',
    createdAt: getSeedTimestamp(6),
  },
  {
    workItemId: 'WI-7',
    ownerNodeId: 8,
    ownerUserId: 'U-1',
    title: 'Git Webhook 시나리오 정리',
    description: '커밋 메시지의 work item ID 감지와 상태 변경 플로우를 시연 기준으로 문서화합니다.',
    status: 'todo',
    priority: 2,
    weight: 1,
    progress: 15,
    startDate: '2026-03-19',
    dueDate: '2026-04-03',
    parentWorkItemId: 'WI-1',
    createdAt: getSeedTimestamp(8),
  },
  {
    workItemId: 'WI-8',
    ownerNodeId: 6,
    ownerUserId: 'U-2',
    title: '발표/데모 준비',
    description: '데모 계정, 발표 흐름, 예상 질의 대응 메모를 최종 리허설 기준으로 정리합니다.',
    status: 'in-progress',
    priority: 2,
    weight: 1,
    progress: 35,
    startDate: '2026-03-20',
    dueDate: '2026-04-05',
    parentWorkItemId: 'WI-1',
    createdAt: getSeedTimestamp(8),
  },
]

function cloneUsers(users: UserRecord[]) {
  return users.map((user) => ({ ...user }))
}

function cloneNodes(nodes: OrganizationNodeRecord[]) {
  return nodes.map((node) => ({ ...node, path: [...node.path] }))
}

function cloneRoles(roles: RoleAssignmentRecord[]) {
  return roles.map((role) => ({ ...role }))
}

function cloneWorkItems(workItems: WorkItemRecord[]) {
  return workItems.map((item) => ({ ...item }))
}

export function createTeam404WorkspaceSeed(): WorkspaceDatabase {
  const users = cloneUsers(team404SeedUsers)
  const nodes = cloneNodes(team404SeedNodes)
  const roles = cloneRoles(team404SeedRoles)
  const workItems = cloneWorkItems(team404SeedWorkItems)

  return {
    datasetId: TEAM_404_DATASET_ID,
    seedVersion: TEAM_404_SEED_VERSION,
    users,
    nodes,
    roles,
    workItems,
    counters: {
      node: Math.max(0, ...nodes.map((node) => node.id)) + 1,
      role: Math.max(0, ...roles.map((role) => role.id)) + 1,
    },
  }
}
