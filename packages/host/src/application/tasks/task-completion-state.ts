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
export const createTaskCompletionState = (
  publish: ((observation: TaskCompletionObservation) => Effect.Effect<void, HostError>) | undefined,
) => {
  const states = new Map<string, TaskCompletionState>();
  return {
    discard: (repoPath: string, taskId: string) =>
      Effect.gen(function* () {
        states.delete(`${repoPath}\u0000${taskId}`);
        if (publish)
          yield* publish({
            repoPath,
            taskId,
            phase: "settled",
            confirmedDestinations: [],
            uncertainDestinations: [],
          });
      }),
    ensure: (repoPath: string, taskId: string) => {
      const key = `${repoPath}\u0000${taskId}`;
      let state = states.get(key);
      if (!state) {
        state = {
          observation: {
            repoPath,
            taskId,
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
