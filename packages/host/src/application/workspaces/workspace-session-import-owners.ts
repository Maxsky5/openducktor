import { Effect } from "effect";
import {
  type HostError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type {
  RuntimeSessionOwner,
  WorkspaceSessionStoreScope,
} from "../../ports/workspace-session-store-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

export const ownerKey = (runtimeKind: string, externalSessionId: string) =>
  `${runtimeKind}\u0000${externalSessionId}`;

/**
 * Reads the owners recorded by the other configured workspaces of the same Git repository.
 * A native conversation in a shared worktree can belong to one of them, and has one owner only.
 */
export const createOtherWorkspaceOwnersReader =
  ({
    settings,
    git,
    candidateDirectory,
    listRuntimeOwners,
  }: {
    settings: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
    git: Pick<GitPort, "readCheckout">;
    candidateDirectory: (directory: string) => Effect.Effect<string | null, HostError>;
    listRuntimeOwners: (
      input: WorkspaceSessionStoreScope,
    ) => Effect.Effect<RuntimeSessionOwner[], HostError>;
  }) =>
  (scope: WorkspaceSessionStoreScope) =>
    Effect.gen(function* () {
      const catalog = yield* settings
        .getWorkspaceCatalog()
        .pipe(
          Effect.mapError((cause) =>
            toHostOperationError(cause, "workspaceSessionImport.workspaces"),
          ),
        );
      const owners = new Map<string, { workspaceName: string; owner: RuntimeSessionOwner }>();
      // Read the current repository once, and only when another workspace can share it.
      const currentCheckout = yield* Effect.cached(git.readCheckout(scope.repoPath));
      for (const workspace of [...catalog.openWorkspaces, ...catalog.closedWorkspaces]) {
        if (workspace.workspaceId === scope.workspaceId) continue;
        // A workspace whose repository no longer exists has no directory to share.
        const repoPath = yield* candidateDirectory(workspace.repoPath);
        if (repoPath === null) continue;
        const [current, candidate] = yield* Effect.all(
          [currentCheckout, git.readCheckout(repoPath)],
          { concurrency: 2 },
        );
        if (!current) {
          return yield* new HostValidationError({
            field: "repoPath",
            message: `Workspace repository is not a Git work tree: ${scope.repoPath}. Restore the repository before you import a chat.`,
          });
        }
        // A directory outside any work tree shares no Git directory with the repository.
        if (candidate?.commonDirectory !== current.commonDirectory) continue;
        const recorded = yield* listRuntimeOwners({ workspaceId: workspace.workspaceId, repoPath });
        for (const owner of recorded) {
          owners.set(ownerKey(owner.runtimeKind, owner.externalSessionId), {
            workspaceName: workspace.workspaceName,
            owner,
          });
        }
      }
      return owners;
    });
