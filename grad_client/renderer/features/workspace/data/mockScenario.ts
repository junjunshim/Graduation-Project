import type { WorkspaceDatabase } from '../model/types'
import {
  createTeam404WorkspaceSeed,
  TEAM_404_DEMO_USER_ID,
} from './seed.js'

export type WorkspaceMockScenario = 'default' | 'empty' | 'boundary' | 'error'

const MOCK_SCENARIO_SEED_VERSION = 20260829

export function getWorkspaceMockScenario(): WorkspaceMockScenario {
  const scenario = import.meta.env.VITE_WORKSPACE_MOCK_SCENARIO?.trim().toLowerCase()

  if (scenario === 'empty' || scenario === 'boundary' || scenario === 'error') {
    return scenario
  }

  return 'default'
}

export function createMockScenarioSeed(scenario: WorkspaceMockScenario): WorkspaceDatabase {
  const defaultSeed = createTeam404WorkspaceSeed()

  if (scenario === 'default') {
    return defaultSeed
  }

  if (scenario === 'error') {
    throw new Error('의도적으로 발생시킨 목 데이터 오류 시나리오입니다.')
  }

  const demoUser = defaultSeed.users.find((user) => user.userId === TEAM_404_DEMO_USER_ID)

  if (!demoUser) {
    throw new Error('목 시나리오의 데모 사용자를 찾을 수 없습니다.')
  }

  if (scenario === 'empty') {
    const userWithoutWorkspace = { ...demoUser }
    delete userWithoutWorkspace.personalNodeId

    return {
      datasetId: 'team-404-empty-workspace',
      seedVersion: MOCK_SCENARIO_SEED_VERSION,
      users: [userWithoutWorkspace],
      nodes: [],
      roles: [],
      workItems: [],
      counters: { node: 1, role: 1 },
    }
  }

  const personalNode = defaultSeed.nodes.find((node) => node.id === demoUser.personalNodeId)
  const personalRole = defaultSeed.roles.find(
    (role) => role.nodeId === demoUser.personalNodeId && role.userId === demoUser.userId,
  )

  if (!personalNode || !personalRole) {
    throw new Error('목 경계값 시나리오의 개인공간 데이터를 찾을 수 없습니다.')
  }

  return {
    datasetId: 'team-404-boundary-workspace',
    seedVersion: MOCK_SCENARIO_SEED_VERSION,
    users: [{ ...demoUser }],
    nodes: [{ ...personalNode, path: [...personalNode.path] }],
    roles: [{ ...personalRole }],
    workItems: [
      {
        workItemId: 'WI-BOUNDARY-0',
        ownerNodeId: personalNode.id,
        ownerUserId: demoUser.userId,
        title: '빈 선택 필드와 최솟값',
        description: '',
        status: 'todo',
        priority: 1,
        weight: 0,
        progress: 0,
        createdAt: '2026-08-29T00:00:00.000Z',
      },
      {
        workItemId: 'WI-BOUNDARY-100',
        ownerNodeId: personalNode.id,
        ownerUserId: demoUser.userId,
        title: '완료율과 우선순위 최댓값',
        description: '시작일과 마감일이 같은 경계값 업무',
        status: 'done',
        priority: 5,
        weight: 1,
        progress: 100,
        startDate: '2026-08-29',
        dueDate: '2026-08-29',
        parentWorkItemId: 'WI-BOUNDARY-0',
        createdAt: '2026-08-29T00:00:00.000Z',
      },
    ],
    counters: {
      node: personalNode.id + 1,
      role: personalRole.id + 1,
    },
  }
}

export function createConfiguredMockWorkspaceSeed() {
  return createMockScenarioSeed(getWorkspaceMockScenario())
}
