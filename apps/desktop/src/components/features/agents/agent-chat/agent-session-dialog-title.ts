export const resolveAgentSessionDialogTitle = (
  requestedTitle: string,
  sessionTitle: string | null | undefined,
): string => {
  const trimmedSessionTitle = sessionTitle?.trim();
  return trimmedSessionTitle && trimmedSessionTitle.length > 0
    ? trimmedSessionTitle
    : requestedTitle;
};
