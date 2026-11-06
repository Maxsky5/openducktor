import { taskReviewRejection, type ResolvedTaskCard as TaskCard } from "@openducktor/workflows";
import { memo, type ReactElement } from "react";
import { Badge } from "@/components/ui/badge";

export const ReviewRejectedBadge = memo(function ReviewRejectedBadge({
  task,
}: {
  task: TaskCard;
}): ReactElement | null {
  const rejection = taskReviewRejection(task);
  if (!rejection) {
    return null;
  }

  return (
    <Badge
      variant="outline"
      className="h-6 rounded-full gap-1.5 px-2.5 text-[11px] font-semibold border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300"
      title={rejection.description}
    >
      {rejection.label}
    </Badge>
  );
});
