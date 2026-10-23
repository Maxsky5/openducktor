import type { TaskCard } from "@openducktor/contracts";
import { taskDocumentQueryOptions } from "@openducktor/frontend-core/queries/documents";
import { useQueries, useQueryClient } from "@tanstack/react-query";

/** Keep workflow reads active for the task, independent of its transcript and shown panel. */
export function useAgentStudioArtifacts(repoPath: string | null, task: TaskCard | null): void {
  const queryClient = useQueryClient();
  useQueries({
    queries:
      repoPath && task
        ? (["spec", "plan", "qaReport"] as const)
            .filter((kind) => task.artifactSummary[kind].has)
            .map((kind) => ({
              ...taskDocumentQueryOptions(
                queryClient,
                repoPath,
                task.id,
                kind === "qaReport" ? "qa" : kind,
              ),
              // The preview observes results; this owner only keeps their reads active.
              notifyOnChangeProps: [],
            }))
        : [],
  });
}
