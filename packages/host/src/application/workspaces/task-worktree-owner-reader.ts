import { emptyWorktreeOwners } from "@openducktor/core";
import { Effect } from "effect";
import type { TaskWorktreeOwnerReader } from "../../ports/task-worktree-owner-port";
import {
  readWorktreePathOwners,
  type WorktreeOwnerDependencies,
} from "./workspace-session-worktree-owners";

/**
 * Reads the owners of task worktrees with the same rules as chat archive. A worktree that no
 * longer exists has nothing to remove, so its owners do not count.
 */
export const createTaskWorktreeOwnerReader = (
  dependencies: WorktreeOwnerDependencies,
): TaskWorktreeOwnerReader => ({
  readOwners: ({ workspaceId, repoPath, taskIds, worktreePaths, history }) =>
    Effect.gen(function* () {
      const existing = yield* Effect.filter(worktreePaths, (path) =>
        dependencies.settingsConfig.pathExists(path),
      );
      if (existing.length === 0) return { owners: emptyWorktreeOwners(), historyReadErrors: [] };
      return yield* readWorktreePathOwners(dependencies, { workspaceId, repoPath }, existing, {
        source: { kind: "tasks", taskIds },
        history,
      });
    }),
});
