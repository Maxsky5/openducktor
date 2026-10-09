import type { RepoActions, WorkspaceSessionRefInput } from "@openducktor/contracts";
import { Effect } from "effect";
import { HostOperationError } from "../../effect/host-errors";
import type { WorktreeActionRun } from "../actions/worktree-action-runner";

/** Runs the worktree-creation actions in terminals that the Workspace Session owns. */
export const runWorkspaceSessionWorktreeActions = (
  actionRun: WorktreeActionRun,
  input: { owner: WorkspaceSessionRefInput; repoPath: string; actions: RepoActions },
): Effect.Effect<void, HostOperationError> =>
  actionRun
    .run({
      context: {
        kind: "workspace_session",
        workspaceId: input.owner.workspaceId,
        sessionId: input.owner.sessionId,
        repoPath: input.repoPath,
      },
      actions: input.actions,
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new HostOperationError({
            operation: "workspaceSession.worktreeActions",
            message: cause.message,
            cause,
          }),
      ),
    );

/** Stops the action terminals before a rollback. A failure adds to the setup failure message. */
export const stopWorktreeActionTerminals = (
  actionRun: WorktreeActionRun,
  failure: { operation: string; message: string },
): Effect.Effect<void, HostOperationError> =>
  actionRun.stopTerminals().pipe(
    Effect.mapError(
      (rollbackFailure) =>
        new HostOperationError({
          operation: failure.operation,
          message: `${failure.message}\n${rollbackFailure.message}`,
          cause: rollbackFailure,
        }),
    ),
  );
