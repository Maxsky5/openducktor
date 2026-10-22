import type { BrowserTabOwner } from "@openducktor/contracts";
import { Effect } from "effect";
import type { GitPort } from "../../ports/git-port";
import type { TaskReader } from "../../ports/task-repository-ports";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import { createWorkspaceSessionRecordReader } from "../workspaces/workspace-session-record-reader";
import type { WorkspaceSettingsService } from "../workspaces/workspace-settings-model";
import { BrowserServiceError } from "./browser-service-error";

export type BrowserOwnerAccessDependencies = {
  settings: Pick<WorkspaceSettingsService, "getRepoConfig">;
  git: Pick<GitPort, "canonicalizePath">;
  tasks: Pick<TaskReader, "getTask">;
  workspaceSessions: Pick<WorkspaceSessionStorePort, "get">;
};

/** Checks that the task or active Workspace Session of a tab owner exists in its workspace. */
export const createBrowserOwnerAccess = ({
  settings,
  git,
  tasks,
  workspaceSessions,
}: BrowserOwnerAccessDependencies) => {
  const sessionRecords = createWorkspaceSessionRecordReader({
    settings,
    git,
    store: workspaceSessions,
  });
  const requireOwner = (
    owner: BrowserTabOwner,
    operation: string,
  ): Effect.Effect<void, BrowserServiceError> =>
    Effect.gen(function* () {
      const config = yield* settings.getRepoConfig(owner.workspaceId).pipe(
        Effect.mapError(
          (cause) =>
            new BrowserServiceError({
              code: "browser_owner_unavailable",
              operation,
              message: `Workspace ${owner.workspaceId} is not available.`,
              cause,
            }),
        ),
      );
      const readFailure = (cause: { readonly message: string }) =>
        new BrowserServiceError({
          code: "browser_owner_unavailable",
          operation,
          message: `Could not read ${ownerLabel(owner)}: ${cause.message} Open the task or Workspace Session again.`,
          cause,
        });
      if (owner.kind === "task") {
        yield* tasks
          .getTask({ repoPath: config.repoPath, taskId: owner.taskId })
          .pipe(Effect.mapError(readFailure));
        return;
      }
      const { session } = yield* sessionRecords
        .recordFor({ workspaceId: owner.workspaceId, sessionId: owner.sessionId })
        .pipe(Effect.mapError(readFailure));
      if (session.archivedAt !== null) {
        return yield* new BrowserServiceError({
          code: "browser_owner_unavailable",
          operation,
          message: "This Workspace Session is archived. Restore it before you open browser tabs.",
        });
      }
    });

  return { requireOwner };
};

export type BrowserOwnerAccess = ReturnType<typeof createBrowserOwnerAccess>;

const ownerLabel = (owner: BrowserTabOwner): string =>
  owner.kind === "task" ? `task ${owner.taskId}` : `Workspace Session ${owner.sessionId}`;
