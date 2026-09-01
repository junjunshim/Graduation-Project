export function getWorkItemDateRangeError(startDate: string, dueDate: string) {
  if (startDate && dueDate && dueDate < startDate) {
    return '마감일은 시작일보다 빠를 수 없습니다.'
  }

  return null
}
