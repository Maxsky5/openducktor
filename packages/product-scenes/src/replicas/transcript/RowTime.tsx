// The timing of an ODT tool card: ToolMessageTiming of agent-chat-tool-message-timing.tsx. A
// running card shows moving bars and no duration yet.
import type { ReactElement } from "react";
import { RunningBars } from "./RunningBars";
import "./RowTime.css";

export function RowTime({ duration, time }: { duration: string; time: string }): ReactElement {
  return (
    <span className="st-time">
      <RunningBars className="st-time-bars" />
      <span className="st-duration">{duration}</span>
      <span>{time}</span>
    </span>
  );
}
