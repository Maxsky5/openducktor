import { Effect } from "effect";
import { type HostError, toHostOperationError } from "../../effect/host-errors";
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
    git: Pick<GitPort, "shareGitCommonDirectory">;
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
      for (const workspace of [...catalog.openWorkspaces, ...catalog.closedWorkspaces]) {
        if (workspace.workspaceId === scope.workspaceId) continue;
        // A workspace whose repository no longer exists has no directory to share.
        const repoPath = yield* candidateDirectory(workspace.repoPath);
        if (repoPath === null) continue;
        if (!(yield* git.shareGitCommonDirectory(scope.repoPath, repoPath))) continue;
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
