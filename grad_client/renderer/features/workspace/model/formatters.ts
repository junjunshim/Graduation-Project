export function formatWorkspaceDate(value?: string) {
  return value ? value.split('-').join('.') : '일정 미정'
}

export function formatWorkspaceTimestamp(value: string) {
  const [date, time = ''] = value.split('T')
  return `${formatWorkspaceDate(date)}${time ? ` · ${time.slice(0, 5)}` : ''}`
}
