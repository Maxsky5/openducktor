// The running border ray of the desktop styles, on a task card or the composer. The ray circles
// the box of its parent. The parent shows it while an agent works, and sets its stroke and speed.
import type { ReactElement } from "react";
import { classes } from "../classes";
import "./Ray.css";

export function Ray({ className }: { className: string }): ReactElement {
  return (
    <svg className={classes("ui-ray", className)} aria-hidden="true">
      <rect pathLength={100} />
    </svg>
  );
}
