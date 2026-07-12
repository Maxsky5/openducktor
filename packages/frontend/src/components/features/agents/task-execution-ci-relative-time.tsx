import type { ReactElement } from "react";
import { formatCiRelativeTime } from "./task-execution-ci-relative-time-format";

export function TaskExecutionCiRelativeTime({ timestamp }: { timestamp: string }): ReactElement {
  return (
    <time dateTime={timestamp} title={timestamp}>
      {formatCiRelativeTime(timestamp)}
    </time>
  );
}
