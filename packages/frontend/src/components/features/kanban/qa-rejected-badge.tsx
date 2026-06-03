import type { TaskCard } from "@openducktor/contracts";
import { memo, type ReactElement } from "react";
import { Badge } from "@/components/ui/badge";
import { isQaRejectedTask } from "@/lib/task-qa";

export const QaRejectedBadge = memo(function QaRejectedBadge({
  task,
}: {
  task: TaskCard;
}): ReactElement | null {
  if (!isQaRejectedTask(task)) {
    return null;
  }

  return (
    <Badge
      variant="outline"
      className="h-6 rounded-full gap-1.5 px-2.5 text-[11px] font-semibold border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300"
      title="This task is back in progress because QA rejected the previous implementation."
    >
      QA Rejected
    </Badge>
  );
});
