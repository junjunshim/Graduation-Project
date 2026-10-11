import { useMemo } from 'react'
import type { GithubCommit } from '../data/githubService'
import { layoutGitGraph } from '../model/gitGraph'
import styles from './GithubCommitGraph.module.css'

type GithubCommitGraphProps = {
  commits: GithubCommit[]
}

/** 레인 색. 디자인 시스템의 강조색을 순환한다. */
const LANE_COLORS = [
  'var(--accent-blue)',
  'var(--accent-purple)',
  'var(--accent-amber)',
  'var(--accent-green)',
  'var(--accent-red)',
]

/** 행 높이 = 커밋 2줄(제목 + 메타). SVG 선도 이 높이에 맞춘다(CSS .row 와 같아야 한다). */
const ROW_HEIGHT = 40
const LANE_WIDTH = 14
const NODE_RADIUS = 3.5

/** 제목 줄에 붙일 장식 칩의 최대 개수. 좁은 사이드바라 넘치면 접는다. */
const MAX_REF_CHIPS = 2

function laneColor(lane: number) {
  return LANE_COLORS[lane % LANE_COLORS.length]
}

function laneX(lane: number) {
  return lane * LANE_WIDTH + LANE_WIDTH / 2
}

function shortSha(sha: string) {
  return sha.slice(0, 7)
}

function formatAuthoredAt(value: string) {
  const parsed = new Date(value)

  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('ko-KR', { dateStyle: 'short' })
}

/**
 * 저장소 상세의 커밋 그래프 (git log --graph 상당).
 * 서버 로컬 clone 만 읽으므로 GitHub 자격증명 없이 그린다.
 */
export function GithubCommitGraph({ commits }: GithubCommitGraphProps) {
  const layout = useMemo(() => layoutGitGraph(commits), [commits])

  if (layout.nodes.length === 0) {
    return null
  }

  const width = layout.laneCount * LANE_WIDTH
  const half = ROW_HEIGHT / 2

  return (
    <ul className={styles.list}>
      {layout.nodes.map((node, row) => {
        const incoming = new Set(row > 0 ? layout.laneSpans[row - 1] : [])
        const outgoing = new Set(layout.laneSpans[row])
        const lanes = Array.from(new Set([...incoming, ...outgoing])).sort((left, right) => left - right)
        const merges = layout.edges.filter((edge) => edge.from.row === row && edge.from.lane !== edge.to.lane)

        return (
          <li key={node.commit.sha} className={styles.row}>
            <svg
              className={styles.graph}
              width={width}
              height={ROW_HEIGHT}
              viewBox={`0 0 ${width} ${ROW_HEIGHT}`}
              aria-hidden="true"
            >
              {lanes.map((lane) => {
                // 이 행에서 처음 생긴 레인은 커밋 자신의 자리일 때만 점에서 아래로 내려간다.
                // 머지로 새로 생긴 레인은 아래 곡선이 대신 그린다.
                const start = incoming.has(lane) ? 0 : lane === node.lane ? half : null
                const end = outgoing.has(lane) ? ROW_HEIGHT : half

                if (start === null || start === end) {
                  return null
                }

                return (
                  <line
                    key={`lane-${lane}`}
                    className={styles.line}
                    x1={laneX(lane)}
                    y1={start}
                    x2={laneX(lane)}
                    y2={end}
                    style={{ stroke: laneColor(lane) }}
                  />
                )
              })}

              {merges.map((edge) => (
                <path
                  key={`merge-${edge.to.lane}-${edge.to.row}`}
                  className={styles.line}
                  d={`M ${laneX(edge.from.lane)} ${half} C ${laneX(edge.from.lane)} ${ROW_HEIGHT * 0.75}, ${laneX(edge.to.lane)} ${ROW_HEIGHT * 0.75}, ${laneX(edge.to.lane)} ${ROW_HEIGHT}`}
                  style={{ stroke: laneColor(edge.to.lane) }}
                />
              ))}

              {layout.converged[row].map((lane) => (
                <line
                  key={`merge-in-${lane}`}
                  className={styles.line}
                  x1={laneX(lane)}
                  y1={half}
                  x2={laneX(node.lane)}
                  y2={half}
                  style={{ stroke: laneColor(lane) }}
                />
              ))}

              <circle
                className={styles.node}
                cx={laneX(node.lane)}
                cy={half}
                r={NODE_RADIUS}
                style={{ fill: laneColor(node.lane) }}
              />
            </svg>

            <div className={styles.body}>
              <div className={styles.titleLine}>
                {node.commit.refs.slice(0, MAX_REF_CHIPS).map((ref) => (
                  <span key={ref} className={styles.refChip} title={ref}>
                    {ref}
                  </span>
                ))}
                <span className={styles.subject} title={node.commit.subject}>
                  {node.commit.subject}
                </span>
              </div>
              <div className={styles.meta}>
                {node.commit.refs.length > MAX_REF_CHIPS ? `+${node.commit.refs.length - MAX_REF_CHIPS} ` : ''}
                {shortSha(node.commit.sha)} · {node.commit.author_name || node.commit.author_email}
                {node.commit.authored_at ? ` · ${formatAuthoredAt(node.commit.authored_at)}` : ''}
              </div>
            </div>
          </li>
        )
      })}
    </ul>
  )
}