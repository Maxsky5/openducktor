import type { BackgroundTaskRow } from "@openducktor/frontend-core/sessions/background-tasks/background-task-bar";
import type { Confirm } from "@/ui/confirm-dialog";

/**
 * Asks the user before it stops one background task, with the words of frontend-core. A row that
 * cannot stop, or that stops already, asks nothing and sends nothing.
 */
export const confirmBackgroundTaskStop = async (
  confirm: Confirm,
  row: Pick<BackgroundTaskRow, "taskId" | "stop" | "confirmation">,
  onStop: (taskId: string) => void,
): Promise<void> => {
  if (!row.stop.control || row.stop.control.busy) return;
  const confirmed = await confirm({
    title: row.confirmation.title,
    message: row.confirmation.description,
    confirmLabel: row.confirmation.confirmLabel,
    icon: "square",
    destructive: true,
  });
  if (confirmed) onStop(row.taskId);
};
