// The duration and the time of a transcript row. A running row shows a spinner instead of the
// duration.
import { LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import "./RowTime.css";

export function RowTime({ duration, time }: { duration: string; time: string }): ReactElement {
  return (
    <span className="st-time">
      <LoaderCircle className="i12 spin" />
      <span className="st-duration">{duration}</span>
      <span>{time}</span>
    </span>
  );
}
