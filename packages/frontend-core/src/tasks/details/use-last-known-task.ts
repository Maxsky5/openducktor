import type { BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import { useState } from "react";

/** A task that leaves the task list while its dialog closes, as after a delete, stays shown. */
export function useLastKnownTask(tasks: readonly TaskCard[], taskId: string): TaskCard | null {
  const currentTask = tasks.find((entry) => entry.id === taskId) ?? null;
  const [lastTask, setLastTask] = useState(currentTask);
  if (currentTask && currentTask !== lastTask) setLastTask(currentTask);
  return currentTask ?? lastTask;
}
