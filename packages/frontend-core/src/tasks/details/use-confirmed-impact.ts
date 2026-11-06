import { useState } from "react";

/**
 * The impact that the user confirmed stays shown while its command runs and while the dialog
 * closes. The command changes the task data that the impact reads, so the live impact would show
 * the result in place of what the user confirmed.
 */
export function useConfirmedImpact<Impact>(
  impact: Impact,
  dialog: { open: boolean; operation: { isPending: boolean } },
): Impact {
  const live = dialog.open && !dialog.operation.isPending;
  const [held, setHeld] = useState<{ impact: Impact } | null>(null);
  if (!live && held === null) setHeld({ impact });
  if (live && held !== null) setHeld(null);
  return live || held === null ? impact : held.impact;
}
