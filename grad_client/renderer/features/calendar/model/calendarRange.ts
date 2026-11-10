/** 로컬 날짜를 캘린더 키(YYYY-MM-DD)로 만든다. */
function toLocalDateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return year + '-' + month + '-' + day
}

/**
 * 업무 캘린더가 조회하는 시작일. 서버와 동일하게 오늘 기준 6개월 전을 쓰고,
 * 대상 월에 같은 날짜가 없으면 그 달의 마지막 날로 보정한다.
 */
export function getWorkItemCalendarRangeStartKey(today: Date) {
  const targetMonthStart = new Date(today.getFullYear(), today.getMonth() - 6, 1)
  const lastDay = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth() + 1,
    0,
  ).getDate()
  const rangeStart = new Date(
    targetMonthStart.getFullYear(),
    targetMonthStart.getMonth(),
    Math.min(today.getDate(), lastDay),
  )

  return toLocalDateKey(rangeStart)
}
