import type { TaskStatus } from "@openducktor/contracts";
import { memo, type ReactElement } from "react";
import { StatusLabel } from "@/ui/badge";
import { TaskChip } from "./task-chip";
import { statusChipPaint } from "./task-chip-paint";
import { taskStatusLabel, taskStatusTone } from "./task-status-paint";

/**
 * A task status badge in the desktop status colors. Its label carries the status, so color is
 * not the only signal.
 */
export const TaskStatusBadge = memo(function TaskStatusBadge({
  status,
  quiet = false,
  size = "md",
}: {
  status: TaskStatus;
  /** A dot and a word instead of a colored badge, for dense rows. */
  quiet?: boolean;
  size?: "sm" | "md";
}): ReactElement {
  const label = taskStatusLabel(status);
  return quiet ? (
    <StatusLabel label={label} tone={taskStatusTone(status)} />
  ) : (
    <TaskChip
      label={label}
      paint={statusChipPaint(status)}
      size={size}
      accessibilityLabel={`Status ${label}`}
    />
  );
});
