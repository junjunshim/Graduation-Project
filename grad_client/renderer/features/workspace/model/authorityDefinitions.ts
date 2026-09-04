import type { StandardRoleName } from './types'

export type AuthorityBitInfo = {
  bit: number
  key: string
  label: string
  category: 'space' | 'work' | 'file' | 'manage' | 'role' | 'history' | 'special'
  categoryLabel: string
  description: string
  prerequisites: number[] // 이 권한이 켜지기 위해 반드시 켜져 있어야 하는 부모 비트 목록
}

export const AUTHORITY_BITS: AuthorityBitInfo[] = [
  // 1. 공간/노드 (Bit 0 ~ 3)
  {
    bit: 0,
    key: 'NODE_INFO_VIEW',
    label: '노드 정보 조회',
    category: 'space',
    categoryLabel: '공간 및 노드',
    description: '해당 워크스페이스 공간의 기본 정보와 개요를 조회합니다. (모든 권한의 최상위 필수 권한)',
    prerequisites: [],
  },
  {
    bit: 1,
    key: 'NODE_MEMBERS_VIEW',
    label: '멤버 및 역할 목록 조회',
    category: 'space',
    categoryLabel: '공간 및 노드',
    description: '워크스페이스에 소속된 멤버와 역할 목록을 식별합니다.',
    prerequisites: [0],
  },
  {
    bit: 2,
    key: 'NODE_SUB_VIEW',
    label: '하위 서브 노드 탐색',
    category: 'space',
    categoryLabel: '공간 및 노드',
    description: '해당 노드 하위의 모든 서브 노드(하위 팀/프로젝트)를 탐색합니다.',
    prerequisites: [0],
  },
  {
    bit: 3,
    key: 'NODE_PARENT_VIEW',
    label: '상위 조상 노드 탐색',
    category: 'space',
    categoryLabel: '공간 및 노드',
    description: '상위 부모 노드 및 조상 트리를 탐색/조회합니다.',
    prerequisites: [0],
  },

  // 2. 업무(WorkItem) (Bit 4 ~ 11)
  {
    bit: 4,
    key: 'WI_PUBLIC_VIEW',
    label: '공개 업무 조회',
    category: 'work',
    categoryLabel: '업무 (WorkItem)',
    description: '노드 내 공개 업무 목록과 타임라인을 조회합니다.',
    prerequisites: [0],
  },
  {
    bit: 5,
    key: 'WI_OTHERS_DETAIL_VIEW',
    label: '타인 업무 상세/댓글 조회',
    category: 'work',
    categoryLabel: '업무 (WorkItem)',
    description: '다른 팀원이 담당하는 업무의 상세 내용과 댓글을 확인합니다.',
    prerequisites: [4, 1, 0],
  },
  {
    bit: 6,
    key: 'WI_HIDDEN_VIEW',
    label: '숨김 업무 조회',
    category: 'work',
    categoryLabel: '업무 (WorkItem)',
    description: '비공개/숨김 속성으로 등록된 업무를 식별하고 상세 조회합니다.',
    prerequisites: [4, 0],
  },
  {
    bit: 8,
    key: 'WI_PERSONAL_CHANGE',
    label: '본인 업무 생성/변경/삭제',
    category: 'work',
    categoryLabel: '업무 (WorkItem)',
    description: '본인에게 할당된 업무를 새로 생성하거나 수정, 삭제합니다.',
    prerequisites: [4, 0],
  },
  {
    bit: 9,
    key: 'WI_HIDDEN_CHANGE',
    label: '숨김 업무 생성/변경',
    category: 'work',
    categoryLabel: '업무 (WorkItem)',
    description: '숨김 속성을 가진 업무를 생성하거나 속성을 변경합니다.',
    prerequisites: [6, 8, 4, 0],
  },
  {
    bit: 10,
    key: 'WI_ASSIGN',
    label: '타인에게 업무 배정',
    category: 'work',
    categoryLabel: '업무 (WorkItem)',
    description: '다른 구성원에게 새로운 업무를 배정하거나 담당자를 변경합니다.',
    prerequisites: [1, 4, 0],
  },
  {
    bit: 11,
    key: 'WI_OTHERS_CHANGE',
    label: '타인 업무 수정/삭제',
    category: 'work',
    categoryLabel: '업무 (WorkItem)',
    description: '다른 구성원이 작성한 업무를 직접 수정하거나 삭제합니다.',
    prerequisites: [5, 8, 1, 4, 0],
  },

  // 3. 파일 및 산출물 (Bit 16 ~ 17)
  {
    bit: 16,
    key: 'FILE_VIEW',
    label: '파일 조회/다운로드',
    category: 'file',
    categoryLabel: '파일 및 산출물',
    description: '업무에 첨부된 산출물 파일을 확인하고 다운로드합니다.',
    prerequisites: [4, 0],
  },
  {
    bit: 17,
    key: 'FILE_CHANGE',
    label: '파일 업로드/삭제',
    category: 'file',
    categoryLabel: '파일 및 산출물',
    description: '업무에 파일을 새로 업로드하거나 기존 파일을 삭제합니다.',
    prerequisites: [16, 4, 0],
  },

  // 4. 공간 관리 (Bit 12 ~ 13)
  {
    bit: 12,
    key: 'NODE_INFO_CHANGE',
    label: '노드 메타데이터 수정',
    category: 'manage',
    categoryLabel: '공간 관리',
    description: '해당 워크스페이스 공간의 이름, 속성 등의 기본 설정을 변경합니다.',
    prerequisites: [0],
  },
  {
    bit: 13,
    key: 'NODE_SUB_CREATE',
    label: '하위 서브 노드 생성',
    category: 'manage',
    categoryLabel: '공간 관리',
    description: '현재 워크스페이스 하위에 새로운 하위 팀이나 프로젝트 노드를 생성합니다.',
    prerequisites: [0],
  },

  // 5. 역할 및 권한 관리 (Bit 14 ~ 15)
  {
    bit: 14,
    key: 'NODE_ADD_ROLE',
    label: '멤버 초대 및 역할 부여',
    category: 'role',
    categoryLabel: '역할 및 인원 관리',
    description: '노드에 새로운 멤버를 참여시키고 기존 역할을 부여하거나 회수합니다.',
    prerequisites: [1, 0],
  },
  {
    bit: 15,
    key: 'ROLE_CHANGE',
    label: '역할 권한 정의/수정',
    category: 'role',
    categoryLabel: '역할 및 인원 관리',
    description: '커스텀 역할을 생성하고 각 역할의 24비트 권한을 편집합니다.',
    prerequisites: [14, 1, 0],
  },

  // 6. 히스토리 (Bit 20 ~ 21)
  {
    bit: 20,
    key: 'HISTORY_PERSONAL_VIEW',
    label: '개인 활동 이력 조회',
    category: 'history',
    categoryLabel: '활동 히스토리',
    description: '본인이 수행한 업무 및 데이터 변경 이력을 조회합니다.',
    prerequisites: [0],
  },
  {
    bit: 21,
    key: 'HISTORY_ALL_VIEW',
    label: '전체 인원 활동 이력 조회',
    category: 'history',
    categoryLabel: '활동 히스토리',
    description: '워크스페이스 내 모든 구성원의 활동 및 변경 로그 전체를 조회합니다.',
    prerequisites: [20, 1, 0],
  },

  // 7. 특수 제어 (Bit 23)
  {
    bit: 23,
    key: 'DENY',
    label: '절대 거부 (DENY)',
    category: 'special',
    categoryLabel: '특수 제어',
    description: '모든 권한 및 상속을 즉시 무효화하고 접근을 전면 차단합니다.',
    prerequisites: [],
  },
]

export const DEFAULT_ROLE_AUTHORITIES: Record<StandardRoleName, string> = {
  ADMIN: '011111111111111111111111',
  MANAGER: '001100111111111101111111',
  MEMBER: '000100110000001101010111',
  VIEWER: '000000000000000000010001',
}

export type AuthorityPreset = {
  id: string
  label: string
  description: string
  bitmask: string
}

export const AUTHORITY_PRESETS: AuthorityPreset[] = [
  {
    id: 'manager',
    label: '관리자형 (Manager)',
    description: '공간/역할/업무 전체 관리 및 모든 이력 조회',
    bitmask: '001100111111111101111111',
  },
  {
    id: 'member',
    label: '일반 멤버형 (Member)',
    description: '본인 업무 생성/수정, 파일 업로드 및 개인 이력',
    bitmask: '000100110000001101010111',
  },
  {
    id: 'viewer',
    label: '읽기 전용형 (Viewer)',
    description: '노드 기본 정보 및 공개 업무 목록 단순 조회',
    bitmask: '000000000000000000010001',
  },
  {
    id: 'clear',
    label: '모든 권한 해제',
    description: '공간 기본 조회만 남기고 모든 권한 해제',
    bitmask: '000000000000000000000001',
  },
]

// 24비트 문자열을 비트 인덱스 Set으로 변환
export function parseAuthorityBitSet(bitmaskStr: string): Set<number> {
  const set = new Set<number>()
  const padded = bitmaskStr.trim().padStart(24, '0')
  for (let bit = 0; bit < 24; bit++) {
    // Big-Endian: Bit 23이 맨 앞(index 0), Bit 0이 맨 끝(index 23)
    const charIndex = 23 - bit
    if (padded[charIndex] === '1') {
      set.add(bit)
    }
  }
  return set
}

// 비트 인덱스 Set을 24자리 2진수 문자열로 변환
export function stringifyAuthorityBitSet(set: Set<number>): string {
  const chars = new Array(24).fill('0')
  set.forEach((bit) => {
    if (bit >= 0 && bit < 24) {
      const charIndex = 23 - bit
      chars[charIndex] = '1'
    }
  })
  return chars.join('')
}

// 24자리 2진수 문자열을 Hex 문자열(0x...)로 변환
export function bitmaskToHex(bitmaskStr: string): string {
  const num = parseInt(bitmaskStr, 2)
  if (isNaN(num)) return '0x000000'
  return '0x' + num.toString(16).toUpperCase().padStart(6, '0')
}

// 특정 비트를 토글했을 때 의존성 체인(Cascade Enable / Cascade Disable) 계산
export function toggleAuthorityBit(
  currentSet: Set<number>,
  targetBit: number,
  targetValue: boolean,
): Set<number> {
  const nextSet = new Set(currentSet)

  if (targetValue) {
    // 🟢 켜는 경우: 해당 비트와 모든 선행(부모) 필수 비트를 자동으로 ON
    nextSet.add(targetBit)

    const addPrerequisites = (bit: number) => {
      const info = AUTHORITY_BITS.find((b) => b.bit === bit)
      if (info) {
        info.prerequisites.forEach((pBit) => {
          nextSet.add(pBit)
          addPrerequisites(pBit)
        })
      }
    }

    addPrerequisites(targetBit)
  } else {
    // 🔴 끄는 경우: 해당 비트를 끄고, 이 비트를 전제조건으로 사용하는 모든 하위 비트를 자동으로 OFF
    nextSet.delete(targetBit)

    let changed = true
    while (changed) {
      changed = false
      AUTHORITY_BITS.forEach((info) => {
        if (nextSet.has(info.bit)) {
          const isMissingPrereq = info.prerequisites.some((pBit) => !nextSet.has(pBit))
          if (isMissingPrereq) {
            nextSet.delete(info.bit)
            changed = true
          }
        }
      })
    }
  }

  return nextSet
}

// 특정 비트를 토글했을 때 함께 켜지거나 꺼지는 비트 목록 분석 (UX 안내용)
export function getCascadeImpact(
  currentSet: Set<number>,
  targetBit: number,
  targetValue: boolean,
): { addedBits: number[]; removedBits: number[] } {
  const nextSet = toggleAuthorityBit(currentSet, targetBit, targetValue)
  const addedBits: number[] = []
  const removedBits: number[] = []

  AUTHORITY_BITS.forEach((b) => {
    if (!currentSet.has(b.bit) && nextSet.has(b.bit)) {
      addedBits.push(b.bit)
    } else if (currentSet.has(b.bit) && !nextSet.has(b.bit)) {
      removedBits.push(b.bit)
    }
  })

  return { addedBits, removedBits }
}
