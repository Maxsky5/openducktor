import { useCallback } from "react";
import { useClipboardCopy } from "@/platform/use-clipboard-copy";

/** Copies a task ID, as the desktop copy control next to each task ID, and says the result. */
export const useCopyTaskId = (): ((taskId: string) => void) => {
  const { copyText } = useClipboardCopy();
  return useCallback(
    (taskId: string) => {
      void copyText(taskId, { copied: `Copied ${taskId}`, failed: "The task ID was not copied." });
    },
    [copyText],
  );
};
