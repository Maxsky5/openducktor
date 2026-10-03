import { setWorkspaceSessionOwnership } from "./workspace-session-live-ownership";
import type { WorkspaceSession } from "@openducktor/contracts";
import { Effect } from "effect";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { WorkspaceSessionServiceDependencies } from "./workspace-session-service";
import { validateWorkspaceSessionTarget } from "./workspace-session-target";
import { withRestoredWorkspaceSessionWorktree } from "./workspace-session-worktree-lifecycle";

export const restoreWorkspaceSession = (
  dependencies: WorkspaceSessionServiceDependencies,
  ref: Parameters<WorkspaceSessionStorePort["restore"]>[0],
  session: WorkspaceSession,
) =>
  Effect.gen(function* () {
    const { store, settings, live } = dependencies;
    let restored = session;
    if (
      session.archivedAt !== null &&
      session.executionTarget.kind === "local_worktree" &&
      session.executionTarget.worktreeState === "removed"
    ) {
      const config = yield* settings.getRepoConfig(ref.workspaceId);
      restored = yield* withRestoredWorkspaceSessionWorktree(
        dependencies,
        { ...config, repoPath: ref.repoPath },
        session.executionTarget,
        (executionTarget) => store.restore({ ...ref, executionTarget }),
      );
    } else if (session.archivedAt !== null) {
      yield* validateWorkspaceSessionTarget(dependencies, ref.repoPath, session.executionTarget);
      restored = yield* store.restore(ref);
    }
    yield* setWorkspaceSessionOwnership(live, ref.repoPath, restored, true);
    return restored;
  });
