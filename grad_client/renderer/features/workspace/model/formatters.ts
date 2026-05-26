const WORKSPACE_LOCALE = 'ko-KR'
const WORKSPACE_TIME_ZONE = 'Asia/Seoul'
const EMPTY_WORKSPACE_DATE_LABEL = '\uC77C\uC815 \uBBF8\uC815'
const EMPTY_WORKSPACE_TIMESTAMP_LABEL = '\uC2DC\uAC04 \uBBF8\uC815'

const DATE_ONLY_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/
const LOCAL_TIMESTAMP_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[T ](?<hour>\d{2}):(?<minute>\d{2})(?::\d{2}(?:\.\d{1,3})?)?$/
const LEADING_DATE_PATTERN = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})/
const LEADING_TIMESTAMP_PATTERN =
  /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})[T ](?<hour>\d{2}):(?<minute>\d{2})/

type DateTokens = {
  year: string
  month: string
  day: string
}

type TimestampTokens = DateTokens & {
  hour: string
  minute: string
}

const workspaceDateFormatter = createWorkspaceFormatter({
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
})

const workspaceTimestampFormatter = createWorkspaceFormatter({
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

function createWorkspaceFormatter(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(WORKSPACE_LOCALE, {
    timeZone: WORKSPACE_TIME_ZONE,
    ...options,
  })
}

function normalizeWorkspaceValue(value?: string) {
  const trimmedValue = value?.trim()
  return trimmedValue ? trimmedValue : null
}

function isValidDate(value: Date) {
  return !Number.isNaN(value.getTime())
}

function readDateTokens(match: RegExpMatchArray | null): DateTokens | null {
  const groups = match?.groups

  if (!groups?.year || !groups.month || !groups.day) {
    return null
  }

  return {
    year: groups.year,
    month: groups.month,
    day: groups.day,
  }
}

function readTimestampTokens(match: RegExpMatchArray | null): TimestampTokens | null {
  const groups = match?.groups

  if (!groups?.year || !groups.month || !groups.day || !groups.hour || !groups.minute) {
    return null
  }

  return {
    year: groups.year,
    month: groups.month,
    day: groups.day,
    hour: groups.hour,
    minute: groups.minute,
  }
}

function readFormatterPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  return parts.find((part) => part.type === type)?.value ?? ''
}

function readDateTokensFromFormatter(value: Date): DateTokens {
  const parts = workspaceDateFormatter.formatToParts(value)

  return {
    year: readFormatterPart(parts, 'year'),
    month: readFormatterPart(parts, 'month'),
    day: readFormatterPart(parts, 'day'),
  }
}

function readTimestampTokensFromFormatter(value: Date): TimestampTokens {
  const parts = workspaceTimestampFormatter.formatToParts(value)

  return {
    year: readFormatterPart(parts, 'year'),
    month: readFormatterPart(parts, 'month'),
    day: readFormatterPart(parts, 'day'),
    hour: readFormatterPart(parts, 'hour'),
    minute: readFormatterPart(parts, 'minute'),
  }
}

function readDateTokensFromParsedValue(value: string) {
  const parsedDate = new Date(value)
  return isValidDate(parsedDate) ? readDateTokensFromFormatter(parsedDate) : null
}

function readTimestampTokensFromParsedValue(value: string) {
  const parsedDate = new Date(value)
  return isValidDate(parsedDate) ? readTimestampTokensFromFormatter(parsedDate) : null
}

function formatDateTokens(tokens: DateTokens) {
  return `${tokens.year}.${tokens.month}.${tokens.day}`
}

function formatShortDateTokens(tokens: DateTokens) {
  return `${Number(tokens.month)}/${Number(tokens.day)}`
}

function formatTimestampTokens(tokens: TimestampTokens) {
  return `${formatDateTokens(tokens)} ${tokens.hour}:${tokens.minute}`
}

function resolveDateTokens(value: string) {
  return (
    readDateTokens(value.match(DATE_ONLY_PATTERN)) ??
    readDateTokens(value.match(LOCAL_TIMESTAMP_PATTERN)) ??
    readDateTokensFromParsedValue(value) ??
    readDateTokens(value.match(LEADING_DATE_PATTERN))
  )
}

function resolveTimestampTokens(value: string) {
  return (
    readTimestampTokens(value.match(LOCAL_TIMESTAMP_PATTERN)) ??
    readTimestampTokensFromParsedValue(value) ??
    readTimestampTokens(value.match(LEADING_TIMESTAMP_PATTERN))
  )
}

export function formatWorkspaceDate(value?: string) {
  const normalizedValue = normalizeWorkspaceValue(value)

  if (!normalizedValue) {
    return EMPTY_WORKSPACE_DATE_LABEL
  }

  const tokens = resolveDateTokens(normalizedValue)
  return tokens ? formatDateTokens(tokens) : normalizedValue
}

export function formatWorkspaceShortDate(value?: string) {
  const normalizedValue = normalizeWorkspaceValue(value)

  if (!normalizedValue) {
    return EMPTY_WORKSPACE_DATE_LABEL
  }

  const tokens = resolveDateTokens(normalizedValue)
  return tokens ? formatShortDateTokens(tokens) : normalizedValue
}

export function formatWorkspaceTimestamp(value: string) {
  const normalizedValue = normalizeWorkspaceValue(value)

  if (!normalizedValue) {
    return EMPTY_WORKSPACE_TIMESTAMP_LABEL
  }

  const tokens = resolveTimestampTokens(normalizedValue)
  return tokens ? formatTimestampTokens(tokens) : normalizedValue
}
