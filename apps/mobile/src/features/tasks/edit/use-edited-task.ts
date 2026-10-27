import { type BuiltinTaskCard as TaskCard } from "@openducktor/workflows";
import { useState } from "react";

/**
 * The task that Edit Task edits: the live version from the task list, or the last version that
 * the list had. A task can leave the list while the editor is open, as after a delete on another
 * client or a close that the Done setting hides. The editor then stays open with its drafts, and
 * a save reports that the task is gone.
 */
export function useEditedTask(liveTask: TaskCard | null): TaskCard | null {
  const [lastTask, setLastTask] = useState(liveTask);
  if (liveTask !== null && liveTask !== lastTask) setLastTask(liveTask);
  return liveTask ?? lastTask;
}
