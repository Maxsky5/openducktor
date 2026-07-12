import type { ReactElement } from "react";
import { humanDate } from "@/lib/task-display";

export function TaskExecutionCiTimestampLine({
  label,
  timestamp,
}: {
  label?: string;
  timestamp: string;
}): ReactElement {
  return (
    <span>
      {label ? `${label} ` : null}
      <time dateTime={timestamp} title={timestamp}>
        {humanDate(timestamp)}
      </time>
    </span>
  );
}
