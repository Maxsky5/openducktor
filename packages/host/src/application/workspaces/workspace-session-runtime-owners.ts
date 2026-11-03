import { Effect } from "effect";
import { HostValidationError, isHostError, toHostOperationError } from "../../effect/host-errors";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { ScopedAgentSessionRef } from "../agent-sessions/agent-session-operation-policy";
import { openWorkspacesAtRepoPath } from "./workspace-session-import-owners";
import type { WorkspaceSettingsService } from "./workspace-settings-model";

/** Finds the saved Workspace Session of a runtime session. A repository path has one workspace. */
export const findWorkspaceSessionOwner = (
  {
    store,
    settings,
  }: {
    store: Pick<WorkspaceSessionStorePort, "findByRuntimeSession">;
    settings: Pick<WorkspaceSettingsService, "getWorkspaceCatalog">;
  },
  runtimeRef: ScopedAgentSessionRef,
) =>
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
    const [match] = yield* store
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
    if (!match) return null;
    const { session, ...scope } = match;
    if (session.executionTarget.workingDirectory !== runtimeRef.workingDirectory)
      return yield* new HostValidationError({
        field: "workingDirectory",
        message: `Runtime directory does not match Workspace Session ${session.id}: ${runtimeRef.workingDirectory}`,
      });
    return { ref: { ...scope, sessionId: session.id }, session };
  });
