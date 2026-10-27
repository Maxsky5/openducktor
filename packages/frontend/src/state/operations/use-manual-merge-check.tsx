import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { settleWithLimit } from "@openducktor/frontend-core/lib/settle-with-limit";
import { checkTaskMergeStatus } from "@openducktor/frontend-core/queries/task-merge-status";
import { taskMergeCheckResultText } from "@openducktor/frontend-core/tasks/presentation/task-merge-status";
import type { QueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { WorkspaceScope } from "@/types/workspace-scope";

/** The workspaces that one manual check runs at a time, as the scheduled checks do. */
const MANUAL_MERGE_CHECK_CONCURRENCY = 4;

/**
 * The manual merge check of the palette. Each workspace check fetches its target remotes first,
 * which can take seconds, so a loading toast shows until every check ends.
 */
export function useManualMergeCheck(queryClient: QueryClient) {
  const [pendingScope, setPendingScope] = useState<WorkspaceScope | null>(null);
  // Block a second call before React commits the pending scope.
  const pendingRef = useRef(false);

  const check = useCallback(
    async (scope: WorkspaceScope): Promise<void> => {
      if (pendingRef.current || scope.targets.length === 0) return;
      pendingRef.current = true;
      setPendingScope(scope);
      const toastId = toast.loading(`Checking merged tasks: ${scope.label}`, {
        description: "OpenDucktor fetches the target branches, then checks each task branch.",
        duration: Infinity,
        dismissible: false,
      });
      try {
        const results = await settleWithLimit(
          scope.targets,
          MANUAL_MERGE_CHECK_CONCURRENCY,
          (target) => checkTaskMergeStatus(queryClient, target.repoPath),
        );
        const failedCount = results.filter((result) => result.status === "rejected").length;
        let title = `Merge check partially completed: ${scope.label}`;
        if (failedCount === 0) title = `Merge check completed: ${scope.label}`;
        if (failedCount === results.length) title = `Merge check failed: ${scope.label}`;
        const description = (
          <div className="max-h-[50vh] overflow-y-auto whitespace-pre-wrap">
            {results.map((result, index) => {
              const target = scope.targets[index];
              if (!target) return null;
              return (
                <p key={target.workspaceId}>
                  {target.workspaceName}:{" "}
                  {result.status === "fulfilled"
                    ? taskMergeCheckResultText(result.value)
                    : `Check failed. ${errorMessage(result.reason)}`}
                </p>
              );
            })}
          </div>
        );
        const options = { id: toastId, description, dismissible: true, closeButton: true };
        if (failedCount === 0) toast.success(title, { ...options, duration: 6000 });
        else if (failedCount === results.length)
          toast.error(title, { ...options, duration: Infinity });
        else toast.warning(title, { ...options, duration: Infinity });
      } finally {
        pendingRef.current = false;
        setPendingScope(null);
      }
    },
    [queryClient],
  );

  return { pendingScope, check };
}
