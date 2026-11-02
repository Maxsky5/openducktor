import { sqliteValues } from "./sqlite-parameters";
import { eq, inArray } from "drizzle-orm";
import { Effect } from "effect";
import { HostValidationError } from "../../effect/host-errors";
import type {
  RuntimeOwnershipScope,
  WorkspaceSessionStoreScope,
} from "../../ports/workspace-session-store-port";
import { workspaces } from "./sqlite-host-settings-schema";
import { hostMetadata, type HostDatabaseSession } from "./sqlite-host-database-schema";

const scopeChanged = () =>
  new HostValidationError({
    field: "workspaceId",
    message:
      "Workspace registration changed while checking session ownership. Reload workspaces and retry.",
  });

/** Runs inside the ownership claim transaction, after Git inspected the catalog snapshot. */
export const assertRuntimeOwnershipScope = (
  session: HostDatabaseSession,
  scope: RuntimeOwnershipScope,
  target: WorkspaceSessionStoreScope,
) =>
  Effect.gen(function* () {
    const metadata = yield* session.execute(
      (db) =>
        db
          .select({ catalogRevision: hostMetadata.catalogRevision })
          .from(hostMetadata)
          .where(eq(hostMetadata.singletonId, 1)),
      "runtimeOwnership.catalogRevision",
    );
    const ids = scope.workspaces.map(({ workspaceId }) => workspaceId);
    if (
      metadata[0]?.catalogRevision !== scope.catalogRevision ||
      !scope.workspaces.some(
        ({ workspaceId, repoPath }) =>
          workspaceId === target.workspaceId && repoPath === target.repoPath,
      ) ||
      new Set(ids).size !== ids.length
    )
      return yield* scopeChanged();
    const rows = yield* session.execute(
      (db) =>
        db
          .select({ workspaceId: workspaces.workspaceId, repoPath: workspaces.repoPath })
          .from(workspaces)
          .where(inArray(workspaces.workspaceId, sqliteValues(ids))),
      "runtimeOwnership.workspaces",
    );
    if (
      rows.length !== ids.length ||
      scope.workspaces.some(
        (expected) =>
          !rows.some(
            (row) => row.workspaceId === expected.workspaceId && row.repoPath === expected.repoPath,
          ),
      )
    )
      return yield* scopeChanged();
    return ids;
  });
