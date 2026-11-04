type ProgressLike = {
  progress: number
  computedProgress?: number
}

/**
 * 하위 업무(직계)들의 평균 진행률을 계산한다.
 * - 자체 진행률과 구분되는 값으로, 하위 업무가 없으면 0을 반환한다.
 * - 하위 업무 각각은 서버가 계산한 가중치 반영 진행률(computedProgress)을 우선 사용한다.
 */
export function getChildProgressAverage(children: ProgressLike[]): number {
  if (children.length === 0) {
    return 0
  }

  const total = children.reduce(
    (sum, child) => sum + (child.computedProgress ?? child.progress),
    0,
  )

  return Math.min(100, Math.max(0, Math.round(total / children.length)))
}

/**
 * 진행률에 가중치(%)를 적용한 기여분을 계산한다.
 * 하위 업무 평균 진행률이 종합 진행률에서 차지하는 몫을 구할 때 사용한다.
 */
export function applyProgressWeight(value: number, weight: number): number {
  const ratio = Math.min(100, Math.max(0, weight)) / 100

  return Math.min(100, Math.max(0, Math.round(value * ratio)))
}

export type OverallProgressDetail = {
  selfProgress: number
  childAverage: number
  childWeightedContribution: number
  finalProgress: number
  hasChildren: boolean
}

/**
 * 업무의 자체 진행률과 하위 업무들의 가중치 반영 기여분을 계산하여 종합 진행률 상세 정보를 반환한다.
 */
export function calculateOverallProgress(
  item: { progress: number; weight: number; computedProgress?: number },
  children: ProgressLike[] = [],
): OverallProgressDetail {
  const selfProgress = Math.min(100, Math.max(0, item.progress ?? 0))
  const hasChildren = children.length > 0

  if (!hasChildren) {
    return {
      selfProgress,
      childAverage: 0,
      childWeightedContribution: 0,
      finalProgress: item.computedProgress ?? selfProgress,
      hasChildren: false,
    }
  }

  const childAverage = getChildProgressAverage(children)
  const weight = Math.min(100, Math.max(0, item.weight ?? 0))
  // 하위 업무가 있을 때: 가중치(weight%)만큼 하위 기여분 + (100 - weight%)만큼 자체 기여분
  const childContribution = (childAverage * weight) / 100
  const selfContribution = (selfProgress * (100 - weight)) / 100
  const combined = Math.round(childContribution + selfContribution)
  const finalProgress = item.computedProgress ?? Math.min(100, Math.max(0, combined))

  return {
    selfProgress,
    childAverage,
    childWeightedContribution: applyProgressWeight(childAverage, weight),
    finalProgress,
    hasChildren: true,
  }
}
