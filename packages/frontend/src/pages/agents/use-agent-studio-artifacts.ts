import type { WorkspaceRef } from "@openducktor/contracts";
import { taskDocumentQueryOptions } from "@openducktor/frontend-core/queries/documents";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import type { ResolvedTaskCard as TaskCard } from "@openducktor/workflows";

/** Keep workflow reads active for the task, independent of its transcript and shown panel. */
export function useAgentStudioArtifacts(
  repoPath: WorkspaceRef | null,
  task: TaskCard | null,
): void {
  const queryClient = useQueryClient();
  useQueries({
    queries:
      repoPath && task
        ? Object.entries(task.artifactSummary)
            .filter(([, state]) => state.present)
            .map(([code]) => ({
              ...taskDocumentQueryOptions(queryClient, repoPath, task.id, code),
              // The preview observes results; this owner only keeps their reads active.
              notifyOnChangeProps: [],
            }))
        : [],
  });
}
