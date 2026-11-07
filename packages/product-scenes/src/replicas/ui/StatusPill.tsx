// The task status pill of lib/task-status-presentation.ts: an outline badge in the colors of the
// status. The sidebar shortens the blocked label, and the command palette shows it in full.
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import { type LaneId, statusPillLabel } from "../vocabulary";
import "./StatusPill.css";

type StatusPillProps = ComponentProps<"span"> & {
  status: LaneId | undefined;
  short?: boolean;
  /** The size of an outline badge, as the task cards of a chat and the task details show it. */
  badge?: boolean;
};

export function StatusPill({
  status,
  short = false,
  badge = false,
  className,
  ...attributes
}: StatusPillProps): ReactElement {
  return (
    <span
      className={classes("status-pill", className)}
      hidden={!status}
      data-status={status}
      data-size={badge ? "badge" : undefined}
      {...attributes}
    >
      {status && statusPillLabel(status, short)}
    </span>
  );
}
