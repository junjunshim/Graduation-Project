export function groupFilesByWorkItem<T extends { workItemId?: string; isDeleted?: boolean }>(
  workItems: ReadonlyArray<{ workItemId: string }>,
  files: ReadonlyArray<T>,
  includeDeleted: boolean,
): Map<string, T[]> {
  const grouped = new Map<string, T[]>()

  workItems.forEach((item) => {
    grouped.set(item.workItemId, [])
  })

  files.forEach((file) => {
    if (!file.workItemId || Boolean(file.isDeleted) !== includeDeleted) {
      return
    }

    const bucket = grouped.get(file.workItemId)
    if (bucket) {
      bucket.push(file)
    }
  })

  return grouped
}
