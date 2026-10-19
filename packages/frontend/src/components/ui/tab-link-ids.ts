/**
 * The IDs that link a tab trigger and its content. Radix makes them from the `Tabs` root of each
 * part, so a content under another root, as in a portal, needs both parts to use one base.
 */
export function tabLinkIds(base: string, value: string) {
  const triggerId = `${base}-trigger-${value}`;
  const contentId = `${base}-content-${value}`;
  return {
    trigger: { id: triggerId, "aria-controls": contentId },
    content: { id: contentId, "aria-labelledby": triggerId },
  };
}
