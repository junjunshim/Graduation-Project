const nextParentId =
  current.parentWorkItemId &&
  composer.availableParentItems.some((item) => item.workItemId === current.parentWorkItemId)
    ? current.parentWorkItemId
    : ''
