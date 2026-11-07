// The 10 pixel status dot of session-navigation-parts.tsx and running-status-dot.tsx. A running
// session glows and sends out a ring. A scene changes the state with `data-dot`.
import type { ComponentProps, ReactElement } from "react";
import { classes } from "../classes";
import type { DotState } from "../vocabulary";
import "./StatusDot.css";

type StatusDotProps = ComponentProps<"i"> & { state: DotState };

export function StatusDot({ state, className, ...attributes }: StatusDotProps): ReactElement {
  return <i className={classes("status-dot", className)} data-dot={state} {...attributes} />;
}
