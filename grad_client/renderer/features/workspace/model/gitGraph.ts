import type { GithubCommit } from '../data/githubService.js'

export type GitGraphNode = {
  commit: GithubCommit
  /** 0 부터 시작하는 레인(세로 줄) 번호 */
  lane: number
}

export type GitGraphEdge = {
  /** 자식 커밋에서 시작하는 선 */
  from: { lane: number; row: number }
  /** 부모 커밋에 닿는 선. 레인이 다르면 곡선으로 빠진다 */
  to: { lane: number; row: number }
}

export type GitGraphLayout = {
  nodes: GitGraphNode[]
  edges: GitGraphEdge[]
  laneCount: number
  /** 그 행 아래로 이어지는 레인 번호. 위에서 내려오는 선/아래로 내려가는 선을 가르는 데 쓴다. */
  laneSpans: number[][]
  /** 그 행에서 커밋으로 합쳐진 다른 레인. 점 옆으로 붙는 짧은 연결선을 그리는 데 쓴다. */
  converged: number[][]
}

/**
 * 커밋 목록을 그래프 레인으로 배치한다.
 *
 * 레인은 "다음에 이 SHA 가 나올 자리"를 들고 있는 슬롯이다. 커밋을 위에서 아래로 훑으면서
 *  - 자기 SHA 를 기다리는 레인이 있으면 그 자리를 쓰고(같은 줄기가 이어진다),
 *  - 없으면(새 줄기의 시작) 비어 있는 레인을 잡고, 비어 있는 레인이 없으면 오른쪽에 하나 더 만든다.
 * 첫 부모는 같은 레인을 이어받고, 머지의 나머지 부모는 다른 레인으로 빠진다.
 */
export function layoutGitGraph(commits: GithubCommit[]): GitGraphLayout {
  const nodes: GitGraphNode[] = []
  const laneSpans: number[][] = []
  const converged: number[][] = []
  const lanes: (string | null)[] = []

  for (const commit of commits) {
    let lane = lanes.indexOf(commit.sha)

    if (lane === -1) {
      lane = lanes.indexOf(null)
      if (lane === -1) {
        lane = lanes.length
        lanes.push(null)
      }
    }

    // 같은 커밋을 기다리던 다른 레인은 여기서 합쳐진다(머지로 갈라졌다 다시 만난 줄기).
    const merged: number[] = []
    for (let index = 0; index < lanes.length; index += 1) {
      if (index !== lane && lanes[index] === commit.sha) {
        lanes[index] = null
        merged.push(index)
      }
    }

    lanes[lane] = commit.parents[0] ?? null

    for (const parent of commit.parents.slice(1)) {
      // 이미 다른 레인이 그 조상을 따라가고 있으면 레인을 새로 만들지 않는다.
      if (lanes.includes(parent)) {
        continue
      }

      let slot = lanes.indexOf(null)
      if (slot === -1) {
        slot = lanes.length
        lanes.push(null)
      }
      lanes[slot] = parent
    }

    // 더 이상 기다리는 커밋이 없는 오른쪽 끝 레인은 접는다.
    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop()
    }

    nodes.push({ commit, lane })
    laneSpans.push(lanes.flatMap((sha, index) => (sha === null ? [] : [index])))
    converged.push(merged)
  }

  // 부모를 그리려면 그 부모가 몇 번째 행에 있는지 알아야 한다(limit 밖이면 없다).
  const rowOfSha = new Map<string, number>()
  nodes.forEach((node, row) => {
    if (!rowOfSha.has(node.commit.sha)) {
      rowOfSha.set(node.commit.sha, row)
    }
  })

  const edges: GitGraphEdge[] = []
  nodes.forEach((node, row) => {
    for (const parent of node.commit.parents) {
      const parentRow = rowOfSha.get(parent)

      if (parentRow === undefined) {
        continue
      }

      edges.push({
        from: { lane: node.lane, row },
        to: { lane: nodes[parentRow].lane, row: parentRow },
      })
    }
  })

  const laneCount = nodes.reduce((max, node) => Math.max(max, node.lane + 1), 0)

  return { nodes, edges, laneCount, laneSpans, converged }
}