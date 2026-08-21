import type { ReactElement } from "react";
import {
  formatActiveSessionStopMessage,
  type TaskCleanupOperationLabel,
} from "@/components/features/task-details/task-cleanup-impact-model";

export type TaskStopPreviewState = {
  count: number | null;
  error: string | null;
};

type TaskStopImpactNoticeProps = TaskStopPreviewState & {
  operation: TaskCleanupOperationLabel;
};

export function TaskStopImpactNotice({
  count,
  error,
  operation,
}: TaskStopImpactNoticeProps): ReactElement | null {
  if (error !== null) {
    return (
      <p className="text-destructive-muted">
        Unable to check how many active sessions will be stopped: {error}
      </p>
    );
  }
  if (count !== null && count > 0) {
    return <p>{formatActiveSessionStopMessage(count, operation)}</p>;
  }
  return null;
}
