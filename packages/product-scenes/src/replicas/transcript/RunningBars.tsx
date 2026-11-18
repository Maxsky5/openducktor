// The moving bars of a running tool call: ToolRunningBars of agent-chat-tool-message-timing.tsx.
// A component shows or hides them with the state of its call.
import type { ReactElement } from "react";
import { classes } from "../classes";
import "./RunningBars.css";

export function RunningBars({ className }: { className?: string }): ReactElement {
  return (
    <span className={classes("st-bars", className)}>
      <span />
      <span />
      <span />
    </span>
  );
}
