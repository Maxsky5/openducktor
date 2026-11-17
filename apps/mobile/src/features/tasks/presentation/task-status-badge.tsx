import type { SharedBoardState } from "@openducktor/contracts";
import {
  statusLabel,
  statusTone,
} from "@openducktor/frontend-core/tasks/presentation/task-status-presentation";
import { memo, type ReactElement } from "react";
import { StatusLabel } from "@/ui/badge";
import { TaskChip } from "./task-chip";
import { statusChipPaint } from "./task-chip-paint";

/**
 * A task status badge in the desktop status colors. Its label carries the status, so color is
 * not the only signal.
 */
export const TaskStatusBadge = memo(function TaskStatusBadge({
  status,
  quiet = false,
  size = "md",
}: {
  status: SharedBoardState;
  /** A dot and a word instead of a colored badge, for dense rows. */
  quiet?: boolean;
  size?: "sm" | "md";
}): ReactElement {
  const label = statusLabel(status);
  return quiet ? (
    <StatusLabel label={label} tone={statusTone(status)} />
  ) : (
    <TaskChip
      label={label}
      paint={statusChipPaint(status)}
      size={size}
      accessibilityLabel={`Status ${label}`}
    />
  );
});
