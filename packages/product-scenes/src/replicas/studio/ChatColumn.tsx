// The chat column of the agent chat surface: the transcript, the docked requests, and the
// composer of a session. A task session puts it next to the right panel, and a chat fills
// its window with it.
import type { ReactElement, ReactNode } from "react";
import { classes } from "../classes";
import "./ChatColumn.css";

type ChatColumnProps = { className?: string; children?: ReactNode };

export function ChatColumn({ className, children }: ChatColumnProps): ReactElement {
  return (
    <div className={classes("st-chat", className)} data-chat="">
      {children}
    </div>
  );
}
