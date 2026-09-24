import type { ThemeMode } from '../../../design-system/theme/ThemeContext'
import type { RecurringCategory } from '../../workspace/model/recurringRuleTypes'

const scheduleIllustrationUrls = import.meta.glob('../assets/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>

const EMPTY_ILLUSTRATION = ''

/** midnight_* 자산이 navy 테마 전용이라 이름이 1:1로 대응하지 않는다. */
const THEME_ASSET_PREFIX: Record<ThemeMode, string> = {
  white: 'white',
  beige: 'beige',
  dark: 'dark',
  navy: 'midnight',
}

const CATEGORY_ASSET_INDEX: Record<RecurringCategory, number> = {
  ROUTINE: 1,
  REPORT: 3,
  INSPECTION: 5,
  MEETING: 4,
  EVENT: 2,
}

const DEFAULT_ASSET_INDEX = 1

function findScheduleIllustration(fileName: string) {
  const entry = Object.entries(scheduleIllustrationUrls).find(([assetPath]) =>
    assetPath.endsWith(`/${fileName}`),
  )

  return entry?.[1] ?? EMPTY_ILLUSTRATION
}

export function getScheduleIllustration(
  category: RecurringCategory | undefined,
  themeMode: ThemeMode,
): string {
  const prefix = THEME_ASSET_PREFIX[themeMode] ?? THEME_ASSET_PREFIX.beige
  const index = category ? CATEGORY_ASSET_INDEX[category] ?? DEFAULT_ASSET_INDEX : DEFAULT_ASSET_INDEX

  return findScheduleIllustration(`${prefix}_Image${index}.png`)
}