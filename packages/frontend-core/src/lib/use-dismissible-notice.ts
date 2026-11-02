import { useCallback, useState } from "react";

/**
 * Hides a notice after the user dismisses it. The notice stays hidden while its message stays the
 * same. A new message, or the same message after the notice cleared, shows again. Dismissal hides
 * only the notice: the caller keeps the failure and its recovery actions.
 */
export const useDismissibleNotice = (message: string | null) => {
  const [dismissed, setDismissed] = useState<string | null>(null);
  if (dismissed !== null && dismissed !== message) setDismissed(null);
  const dismiss = useCallback(() => setDismissed(message), [message]);
  return { visible: message === dismissed ? null : message, dismiss };
};
