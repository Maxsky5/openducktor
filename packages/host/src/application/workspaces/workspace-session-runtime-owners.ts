import { Effect } from "effect";
import { HostValidationError, isHostError, toHostOperationError } from "../../effect/host-errors";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { ScopedAgentSessionRef } from "../agent-sessions/agent-session-operation-policy";
import { openWorkspacesAtRepoPath } from "./workspace-session-import-owners";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

/** Physical activity can have several saved associations; selected controls carry their scope. */
export const createWorkspaceSessionRuntimeOwners = ({
  store,
  settings,
}: {
  store: Pick<WorkspaceSessionStorePort, "findByRuntimeSession">;
  settings: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
}) => {
  const findAll = (runtimeRef: ScopedAgentSessionRef) =>
    Effect.gen(function* () {
      const catalog = yield* settings.getWorkspaceCatalog();
      const selectedWorkspaceId =
        runtimeRef.sessionScope?.kind === "repository"
          ? runtimeRef.sessionScope.workspaceId
          : undefined;
      const workspaces = openWorkspacesAtRepoPath(catalog, runtimeRef.repoPath).filter(
        (workspace) =>
          selectedWorkspaceId === undefined || workspace.workspaceId === selectedWorkspaceId,
      );
      if (selectedWorkspaceId !== undefined && workspaces.length === 0)
        return yield* new HostValidationError({
          field: "workspaceId",
          message:
            "The saved session workspace no longer matches this repository. Reload the workspace before continuing.",
        });
      const matches = yield* store
        .findByRuntimeSession({
          workspaces,
          runtimeKind: runtimeRef.runtimeKind,
          externalSessionId: runtimeRef.externalSessionId,
        })
        .pipe(
          Effect.mapError((cause) =>
            isHostError(cause) ? cause : toHostOperationError(cause, "workspaceSession.persist"),
          ),
        );
      const known = [];
      for (const { session, ...scope } of matches) {
        if (session.executionTarget.workingDirectory !== runtimeRef.workingDirectory) {
          if (selectedWorkspaceId === undefined && workspaces.length > 1) continue;
          return yield* new HostValidationError({
            field: "workingDirectory",
            message: `Runtime directory does not match Workspace Session ${session.id}: ${runtimeRef.workingDirectory}`,
          });
        }
        known.push({ ref: { ...scope, sessionId: session.id }, session });
      }
      return known;
    });
  const find = (runtimeRef: ScopedAgentSessionRef) =>
    findAll(runtimeRef).pipe(Effect.map((matches) => (matches.length === 1 ? matches[0]! : null)));
  return { find, findAll };
};
