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
