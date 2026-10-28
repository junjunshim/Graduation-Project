import { useMemo } from 'react'
import type { DashboardActivityChartSeries, DashboardChartPeriod } from '../model/dashboardTypes'
import styles from './DashboardActivityChart.module.css'

type DashboardActivityChartProps = {
  series: DashboardActivityChartSeries
  onPeriodChange: (period: DashboardChartPeriod) => void
}

const PERIOD_OPTIONS: ReadonlyArray<{ value: DashboardChartPeriod; label: string }> = [
  { value: '1d', label: '1일' },
  { value: '1w', label: '1주' },
  { value: '1m', label: '1개월' },
  { value: '6m', label: '6개월' },
]

const SVG_WIDTH = 560
const SVG_HEIGHT = 210
const PLOT_LEFT = 42
const PLOT_RIGHT = 532
const PLOT_TOP = 18
const PLOT_BOTTOM = 166
const PLOT_WIDTH = PLOT_RIGHT - PLOT_LEFT
const PLOT_HEIGHT = PLOT_BOTTOM - PLOT_TOP

export function DashboardActivityChart({ series, onPeriodChange }: DashboardActivityChartProps) {
  const maxTick = useMemo(() => {
    const lastTick = series.yTicks[series.yTicks.length - 1]
    return lastTick && lastTick > 0 ? lastTick : 12
  }, [series.yTicks])

  const pointCount = series.labels.length

  const computePoints = (values: number[]) =>
    values.map((val, index) => {
      const x =
        pointCount > 1
          ? PLOT_LEFT + (index / (pointCount - 1)) * PLOT_WIDTH
          : PLOT_LEFT + PLOT_WIDTH / 2
      const ratio = Math.max(0, Math.min(1, val / maxTick))
      const y = PLOT_BOTTOM - ratio * PLOT_HEIGHT
      return { x, y, value: val, label: series.labels[index] ?? '' }
    })

  const currentPoints = useMemo(
    () => computePoints(series.currentValues),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series.currentValues, series.labels, maxTick],
  )

  const previousPoints = useMemo(
    () => computePoints(series.previousValues),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [series.previousValues, series.labels, maxTick],
  )

  const currentPolyline = currentPoints.map((pt) => `${pt.x},${pt.y}`).join(' ')
  const previousPolyline = previousPoints.map((pt) => `${pt.x},${pt.y}`).join(' ')

  return (
    <section className={styles.panel} aria-label={series.title}>
      <header className={styles.header}>
        <h2 className={styles.title}>{series.title}</h2>

        <div className={styles.periodGroup} role="group" aria-label="활동 차트 기간 선택">
          {PERIOD_OPTIONS.map((option) => {
            const active = series.period === option.value
            return (
              <button
                key={option.value}
                type="button"
                className={styles.periodButton}
                data-active={active ? 'true' : undefined}
                aria-pressed={active}
                onClick={() => onPeriodChange(option.value)}
              >
                {option.label}
              </button>
            )
          })}
        </div>
      </header>

      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} data-series="current" aria-hidden="true" />
          <span>{series.currentLabel}</span>
        </span>
        <span className={styles.legendItem}>
          <span className={styles.legendDot} data-series="previous" aria-hidden="true" />
          <span>{series.previousLabel}</span>
        </span>
      </div>

      <div className={styles.chartWrap}>
        <svg
          className={styles.chartSvg}
          viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
          role="img"
          aria-label={`${series.title} (${series.currentLabel} vs ${series.previousLabel})`}
        >
          {/* 수평 그리드 점선 및 Y축 라벨 */}
          {series.yTicks.map((tickValue) => {
            const ratio = maxTick > 0 ? tickValue / maxTick : 0
            const y = PLOT_BOTTOM - ratio * PLOT_HEIGHT
            return (
              <g key={tickValue}>
                <line
                  x1={PLOT_LEFT}
                  y1={y}
                  x2={PLOT_RIGHT}
                  y2={y}
                  className={styles.gridLine}
                  data-zero={tickValue === 0 ? 'true' : undefined}
                />
                <text
                  x={PLOT_LEFT - 12}
                  y={y + 4}
                  textAnchor="end"
                  className={styles.axisLabel}
                >
                  {tickValue}
                </text>
              </g>
            )
          })}

          {/* 이전 기간 라인 */}
          {previousPoints.length > 1 ? (
            <polyline
              fill="none"
              points={previousPolyline}
              className={styles.linePrevious}
            />
          ) : null}

          {/* 현재 기간 라인 */}
          {currentPoints.length > 1 ? (
            <polyline
              fill="none"
              points={currentPolyline}
              className={styles.lineCurrent}
            />
          ) : null}

          {/* 이전 기간 포인트 */}
          {previousPoints.map((pt, idx) => (
            <g key={`prev-${idx}`}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r={4.2}
                className={styles.pointPrevious}
              >
                <title>{`${pt.label} (${series.previousLabel}): ${pt.value}건`}</title>
              </circle>
            </g>
          ))}

          {/* 현재 기간 포인트 */}
          {currentPoints.map((pt, idx) => (
            <g key={`curr-${idx}`}>
              <circle
                cx={pt.x}
                cy={pt.y}
                r={4.5}
                className={styles.pointCurrent}
              >
                <title>{`${pt.label} (${series.currentLabel}): ${pt.value}건`}</title>
              </circle>
            </g>
          ))}

          {/* X축 라벨 */}
          {currentPoints.map((pt, idx) => (
            <text
              key={`xlabel-${idx}`}
              x={pt.x}
              y={PLOT_BOTTOM + 28}
              textAnchor="middle"
              className={styles.axisLabel}
            >
              {pt.label}
            </text>
          ))}
        </svg>
      </div>
    </section>
  )
}
