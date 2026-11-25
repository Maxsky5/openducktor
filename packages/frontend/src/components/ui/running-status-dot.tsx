import type { ReactElement } from "react";

export function RunningStatusDot(): ReactElement {
  return (
    <span aria-hidden="true" className="running-status-dot size-2.5">
      <span className="relative z-1 size-full rounded-full bg-status-running" />
    </span>
  );
}
