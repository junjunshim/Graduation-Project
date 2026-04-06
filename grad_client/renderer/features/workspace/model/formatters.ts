export function formatWorkspaceDate(value?: string) {
  return value ? value.split('-').join('.') : '\uC77C\uC815 \uBBF8\uC815'
}

function padTimestampUnit(value: number) {
  return String(value).padStart(2, '0')
}

export function formatWorkspaceTimestamp(value: string) {
  const timestamp = new Date(value)

  if (Number.isNaN(timestamp.getTime())) {
    const [date, time = ''] = value.split('T')
    const normalizedTime = time.replace(/(Z|[+-]\d{2}:\d{2})$/, '')
    return `${formatWorkspaceDate(date)}${normalizedTime ? ` ${normalizedTime.slice(0, 5)}` : ''}`
  }

  const dateLabel = formatWorkspaceDate(
    `${timestamp.getFullYear()}-${padTimestampUnit(timestamp.getMonth() + 1)}-${padTimestampUnit(timestamp.getDate())}`,
  )
  const timeLabel = `${padTimestampUnit(timestamp.getHours())}:${padTimestampUnit(timestamp.getMinutes())}`

  return `${dateLabel} ${timeLabel}`
}
