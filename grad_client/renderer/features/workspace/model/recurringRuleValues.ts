export function optionalRecurringNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

export function getActiveRecurringRuleFiles<T extends { isDeleted?: boolean }>(files?: T[] | null): T[] {
  return (files ?? []).filter((file) => !file.isDeleted)
}
