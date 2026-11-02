import { Effect } from "effect";
import { toHostOperationError } from "../../effect/host-errors";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import { openWorkspacesAtRepoPath } from "../../application/workspaces/workspace-session-import-owners";
import type { WorkspaceSettingsService } from "../../application/workspaces/workspace-settings-service";

/** Reads the saved session roots of every open workspace of the repository with one store read. */
export const createLiveSessionRootRefsReader =
  ({
    store,
    settings,
  }: {
    store: Pick<WorkspaceSessionStorePort, "listLiveSessionRoots">;
    settings: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
  }) =>
  (repoPath: string) =>
    Effect.gen(function* () {
      const catalog = yield* settings.getWorkspaceCatalog();
      const roots = yield* store.listLiveSessionRoots({
        workspaces: openWorkspacesAtRepoPath(catalog, repoPath),
      });
      return roots.map((root) => ({ ...root, repoPath }));
    }).pipe(
      Effect.mapError((cause) => toHostOperationError(cause, "workspaceSessions.readOwnedRoots")),
    );
