import type { ComponentProps, ReactElement } from "react";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { cn } from "@/lib/utils";

/**
 * The title and the ID of the task that a dialog changes, on one line. The ID has the copy control
 * of the Kanban cards.
 */
export function TaskIdentity({
  title,
  taskId,
  className,
  ...props
}: Omit<ComponentProps<"div">, "title" | "children"> & {
  title: string;
  taskId: string;
}): ReactElement {
  // A dialog description passes its ID here, so the dialog names the task as its description.
  // The title and the smaller ID share one text baseline, so they read as one line.
  return (
    <div {...props} className={cn("flex min-w-0 items-baseline gap-2", className)}>
      <span className="min-w-0 truncate text-sm font-medium text-foreground" title={title}>
        {title}
      </span>
      <TaskIdBadge taskId={taskId} className="shrink-0" />
    </div>
  );
}

/**
 * The dialog shows the task line first, so Radix would focus its copy control and open its tooltip.
 * The dialog focuses its own content instead. Tab still reaches the copy control.
 */
export const focusDialogContent = (event: Event): void => {
  event.preventDefault();
  if (event.currentTarget instanceof HTMLElement) event.currentTarget.focus();
};
