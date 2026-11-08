// The task status badge of apps/mobile/src/ui/badge.tsx: a capsule in the tone of the status, with
// the short label of the desktop sidebar. statusTone of task-status-presentation.ts picks the tone
// of each status. A scene changes `data-status` and the text.
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import { type LaneId, statusPillLabel } from "../vocabulary";
import "./MobileBadge.css";

type MobileBadgeProps = ComponentProps<"span"> & { status: LaneId | undefined };

export function MobileBadge({ status, className, ...attributes }: MobileBadgeProps): ReactElement {
  return (
    <span
      className={classes("mob-badge", className)}
      hidden={!status}
      data-status={status}
      {...attributes}
    >
      {status && statusPillLabel(status, true)}
    </span>
  );
}
