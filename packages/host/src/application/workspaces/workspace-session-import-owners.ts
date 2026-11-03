import type { WorkspaceCatalog } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import {
  findInCauseChain,
  type HostError,
  HostValidationError,
  isPathNotFoundError,
} from "../../effect/host-errors";
import type { GitPort } from "../../ports/git-port";
import type {
  RuntimeOwnershipScope,
  WorkspaceSessionStoreScope,
} from "../../ports/workspace-session-store-port";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

/** The open workspace that registered this repository path, as a list for store queries. */
export const openWorkspacesAtRepoPath = (
  catalog: Pick<WorkspaceCatalog, "openWorkspaces">,
  repoPath: string,
): WorkspaceSessionStoreScope[] => {
  const path = normalizePathForComparison(repoPath);
  return catalog.openWorkspaces
    .filter((workspace) => normalizePathForComparison(workspace.repoPath) === path)
    .map(({ workspaceId, repoPath }) => ({ workspaceId, repoPath }));
};

export type RuntimeOwnershipScopeDependencies = {
  settings: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
  git: Pick<GitPort, "canonicalizePath" | "readCheckout">;
};

/** An ownership scope with the name of each workspace, for messages about a foreign owner. */
type NamedRuntimeOwnershipScope = Omit<RuntimeOwnershipScope, "workspaces"> & {
  workspaces: readonly (WorkspaceSessionStoreScope & { workspaceName: string })[];
};

/**
 * Resolves the registered workspaces, in every lifecycle state, whose repository has the same Git
 * common directory as the workspace. A native conversation in a shared worktree has one owner in
 * this scope. Git runs here, before the store checks the catalog revision in its transaction.
 * An ownership claim takes the result as its `RuntimeOwnershipScope`.
 */
export const resolveRuntimeOwnershipScope = (
  { settings, git }: RuntimeOwnershipScopeDependencies,
  scope: WorkspaceSessionStoreScope,
): Effect.Effect<NamedRuntimeOwnershipScope, HostError> =>
  Effect.gen(function* () {
    const catalog = yield* settings.getWorkspaceCatalog();
    const current = yield* git.readCheckout(scope.repoPath);
    if (!current)
      return yield* new HostValidationError({
        field: "repoPath",
        message: `Workspace repository is not a Git work tree: ${scope.repoPath}. Restore the repository before saving session ownership.`,
      });
    const candidates = yield* Effect.forEach(
      [
        ...catalog.openWorkspaces,
        ...catalog.closedWorkspaces,
        ...catalog.incompleteRemovals.map(({ workspace }) => workspace),
      ],
      ({ workspaceId, repoPath, workspaceName }) =>
        Effect.gen(function* () {
          if (workspaceId === scope.workspaceId) {
            if (repoPath !== scope.repoPath)
              return yield* new HostValidationError({
                field: "repoPath",
                message: "Workspace repository changed. Reload workspaces and retry.",
              });
            return { ...scope, workspaceName };
          }
          // A workspace whose repository no longer exists has no directory to share.
          const path = yield* git
            .canonicalizePath(repoPath)
            .pipe(
              Effect.catch((cause) =>
                findInCauseChain(cause, isPathNotFoundError) === null
                  ? Effect.fail(cause)
                  : Effect.succeed(null),
              ),
            );
          if (path === null) return null;
          const checkout = yield* git.readCheckout(path);
          return checkout?.commonDirectory === current.commonDirectory
            ? { workspaceId, repoPath, workspaceName }
            : null;
        }),
      { concurrency: 4 },
    );
    const peers = candidates.filter((peer) => peer !== null);
    return { catalogRevision: catalog.catalogRevision, workspaces: peers };
  });
