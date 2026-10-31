import type { ComponentProps, ReactElement } from "react";
import { TaskIdBadge } from "@/components/features/tasks/task-id-badge";
import { cn } from "@/lib/utils";

/**
 * The task that a dialog changes, with the ID copy control of the Kanban cards.
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
  return (
    <div
      {...props}
      className={cn("flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1", className)}
    >
      <span
        className="line-clamp-2 min-w-0 max-w-full break-words text-sm font-medium text-foreground [overflow-wrap:anywhere]"
        title={title}
      >
        {title}
      </span>
      <TaskIdBadge taskId={taskId} className="shrink-0" />
    </div>
  );
}
