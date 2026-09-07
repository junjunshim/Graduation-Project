import { getEffectiveAuthorityBitSet } from '../../workspace/model/effectiveAuthority'
import type { UserRecord, WorkItemRecord, WorkspaceSnapshot } from '../../workspace/model/types'

export type MentionCandidate = {
  userId: string
  name: string
  email: string
}

/**
 * 특정 업무에 접근(조회) 권한이 있는 멤버 목록을 산출합니다.
 * - 본인(작성자)은 멘션 목록에서 제외
 * - 탈퇴하지 않은 유저
 * - 업무 담당자(ownerUserId)는 무조건 포함
 * - 일반 업무(hidden=false): WI_PUBLIC_VIEW (Bit 4) 보유자
 * - 숨김 업무(hidden=true): WI_HIDDEN_VIEW (Bit 6) 보유자
 */
export function getMentionCandidatesForWorkItem(
  item: WorkItemRecord,
  currentUserId: string,
  snapshot: WorkspaceSnapshot,
): MentionCandidate[] {
  const nodeId = item.ownerNodeId
  const isHidden = Boolean(item.hidden)
  const targetBit = isHidden ? 6 : 4 // Bit 6: WI_HIDDEN_VIEW, Bit 4: WI_PUBLIC_VIEW

  const candidateMap = new Map<string, MentionCandidate>()

  snapshot.users.forEach((user: UserRecord) => {
    // 1. 본인 제외 (스냅샷의 유저는 이미 활성 유저만 동기화됨)
    if (!user || user.userId === currentUserId) {
      return
    }

    // 2. 업무 담당자는 무조건 접근 가능
    if (user.userId === item.ownerUserId) {
      candidateMap.set(user.userId, {
        userId: user.userId,
        name: user.name,
        email: user.email,
      })
      return
    }

    // 3. 해당 노드에 대해 업무 조회 권한 비트 보유 여부 검사
    const bitSet = getEffectiveAuthorityBitSet(user.userId, nodeId, snapshot)
    if (bitSet.has(targetBit)) {
      candidateMap.set(user.userId, {
        userId: user.userId,
        name: user.name,
        email: user.email,
      })
    }
  })

  return Array.from(candidateMap.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
}

/**
 * 사용자가 작성한 일반 텍스트에서 @사용자이름 을 감지하여
 * 서버가 인식하는 <mention email='...'>@사용자이름</mention> 태그로 변환합니다.
 */
export function formatContentWithMentions(
  text: string,
  mentionedUsers: MentionCandidate[],
): string {
  let result = text

  // 이름이 긴 유저부터 먼저 치환하여 중복 접두어 오작동 방지
  const sorted = [...mentionedUsers].sort((a, b) => b.name.length - a.name.length)

  sorted.forEach((candidate) => {
    // 이미 <mention> 태그로 둘러싸이지 않은 @이름 패턴 치환
    const pattern = new RegExp(`@${escapeRegex(candidate.name)}(?![^<]*>)`, 'g')
    result = result.replace(pattern, `<mention email="${candidate.email}">@${candidate.name}</mention>`)
  })

  return result
}

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
