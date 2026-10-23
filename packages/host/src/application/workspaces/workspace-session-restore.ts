import {
  type WorkspaceSessionRefInput,
  effectiveWorkspaceSessionTargetBranch,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { TaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import type { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";
import {
  createWorkspaceSessionRecordReader,
  type WorkspaceSessionRecordReaderDependencies,
} from "./workspace-session-record-reader";
import {
  validateWorkspaceSessionTarget,
  type WorkspaceSessionTargetDependencies,
} from "./workspace-session-target";
import { withRestoredWorkspaceSessionWorktree } from "./workspace-session-worktree-lifecycle";

export type WorkspaceSessionRestoreDependencies = WorkspaceSessionTargetDependencies &
  WorkspaceSessionRecordReaderDependencies & {
    store: Pick<WorkspaceSessionStorePort, "restore">;
    lifecycle: Pick<TaskSessionLifecycleCoordinator, "acquireWorktreeLifecycle">;
    operationGate: Pick<ReturnType<typeof createWorkspaceSessionOperationGate>, "run">;
  };

export const createWorkspaceSessionRestore = (
  dependencies: WorkspaceSessionRestoreDependencies,
) => {
  const { store, settings, operationGate } = dependencies;
  const { recordFor } = createWorkspaceSessionRecordReader(dependencies);
  return (input: WorkspaceSessionRefInput) =>
    operationGate.run(
      input,
      Effect.scoped(
        Effect.gen(function* () {
          const { ref, session } = yield* recordFor(input);
          if (session.archivedAt === null) return session;
          const target = session.executionTarget;
          const canonicalPath = yield* dependencies.worktreeFiles.resolveWorktreeRemovalPath(
            target.workingDirectory,
          );
          yield* dependencies.lifecycle.acquireWorktreeLifecycle([canonicalPath]);
          // A sibling can remove or recreate the checkout without updating this record.
          if (
            target.kind === "local_worktree" &&
            (target.worktreeState === "removed" || target.branchName !== null) &&
            !(yield* dependencies.settingsConfig.pathExists(target.workingDirectory))
          ) {
            const config = yield* settings.getRepoConfig(input.workspaceId);
            const targetBranch = effectiveWorkspaceSessionTargetBranch(
              target.kind,
              session.targetBranch,
              config.defaultTargetBranch,
            );
            if (!targetBranch) {
              return yield* new HostValidationError({
                field: "targetBranch",
                message:
                  "The repository default target branch is Tracked upstream, which cannot recreate a branch. Choose a target branch for this chat, then restore it.",
              });
            }
            return yield* withRestoredWorkspaceSessionWorktree(
              dependencies,
              input,
              { ...config, repoPath: ref.repoPath },
              target,
              targetBranch,
              (executionTarget) => store.restore({ ...ref, executionTarget }),
            );
          }
          yield* validateWorkspaceSessionTarget(dependencies, ref.repoPath, target);
          if (target.kind === "local_worktree" && target.worktreeState === "removed") {
            return yield* store.restore({
              ...ref,
              executionTarget: { ...target, worktreeState: "present" },
            });
          }
          return yield* store.restore(ref);
        }),
      ),
    );
};
