import type { DirectMergeRecord, TaskCompletionObservation } from "@openducktor/contracts";
import { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { BoundGitPublication, GitPublicationProgress } from "../../ports/git-port";

export type TaskCompletionState = {
  merge?: DirectMergeRecord;
  appliedTargetOid?: string;
  mergeUncertain?: true;
  publication?: BoundGitPublication;
  progress?: GitPublicationProgress;
  /** The branches that the cleanup deleted. A failed close restores them. */
  deletedBranches?: { name: string; oid: string }[];
  /** The completed cleanup kept the worktree, so a retry that removes it cleans up again. */
  keptWorktree?: true;
  observation: TaskCompletionObservation;
};
type TaskCompletionScope = Pick<TaskCompletionObservation, "workspaceId" | "repoPath" | "taskId">;
const scopeKey = ({ workspaceId, repoPath, taskId }: TaskCompletionScope) =>
  JSON.stringify([workspaceId, repoPath, taskId]);
export const createTaskCompletionState = (
  publish: ((observation: TaskCompletionObservation) => Effect.Effect<void, HostError>) | undefined,
) => {
  const states = new Map<string, TaskCompletionState>();
  return {
    discard: (scope: TaskCompletionScope) =>
      Effect.gen(function* () {
        states.delete(scopeKey(scope));
        if (publish)
          yield* publish({
            ...scope,
            phase: "settled",
            confirmedDestinations: [],
            uncertainDestinations: [],
          });
      }),
    ensure: (scope: TaskCompletionScope) => {
      const key = scopeKey(scope);
      let state = states.get(key);
      if (!state) {
        state = {
          observation: {
            ...scope,
            phase: "settled",
            confirmedDestinations: [],
            uncertainDestinations: [],
          },
        };
        states.set(key, state);
      }
      return state;
    },
    publish: (state: TaskCompletionState) => {
      state.observation.confirmedDestinations =
        state.progress?.destinations
          .filter((value) => value.outcome === "confirmed")
          .map((value) => value.identity) ?? [];
      state.observation.uncertainDestinations =
        state.progress?.destinations
          .filter((value) => value.outcome === "uncertain")
          .map((value) => value.identity) ?? [];
      return publish ? publish(structuredClone(state.observation)) : Effect.void;
    },
  };
};
