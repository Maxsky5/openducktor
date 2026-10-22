import type { WorkspaceSession, WorkspaceSessionArchivePreview } from "@openducktor/contracts";
import { Effect } from "effect";
import { normalizePathForComparison } from "../../domain/path-comparison";
import { runtimeTitle } from "../../domain/workspace-sessions/workspace-session-title";
import { type HostError, HostOperationError } from "../../effect/host-errors";
import type { ClaudeSessionMetadataPort } from "../../ports/claude-session-metadata-port";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type {
  WorkspaceSessionStorePort,
  WorkspaceSessionStoreScope,
} from "../../ports/workspace-session-store-port";
import type { WorkspaceSessionTargetDependencies } from "./workspace-session-target";

export const readWorkspaceSessionWorktreeOwners = (
  dependencies: Pick<WorkspaceSessionTargetDependencies, "settingsConfig" | "worktreeFiles"> & {
    store: Pick<WorkspaceSessionStorePort, "listForWorktreeOwnership">;
    claudeSessionMetadata: ClaudeSessionMetadataPort;
  },
  scope: WorkspaceSessionStoreScope,
  source: WorkspaceSession,
): Effect.Effect<WorkspaceSessionArchivePreview["sharedWith"], HostError | TaskStoreError> =>
  Effect.gen(function* () {
    const canonicalPath = normalizePathForComparison(
      yield* dependencies.worktreeFiles.resolveWorktreeRemovalPath(
        source.executionTarget.workingDirectory,
      ),
    );
    const config = yield* dependencies.settingsConfig.readConfig();
    const scopes = new Map<string, WorkspaceSessionStoreScope>([[scope.workspaceId, scope]]);
    for (const [workspaceId, workspace] of Object.entries(config?.workspaces ?? {})) {
      if (!scopes.has(workspaceId))
        scopes.set(workspaceId, { workspaceId, repoPath: workspace.repoPath });
    }
    const owners: WorkspaceSessionArchivePreview["sharedWith"] = [];
    for (const candidate of scopes.values()) {
      const sessions = yield* dependencies.store.listForWorktreeOwnership(candidate);
      for (const session of sessions) {
        if (candidate.workspaceId === scope.workspaceId && session.id === source.id) continue;
        const executionPath = normalizePathForComparison(
          yield* dependencies.worktreeFiles.resolveWorktreeRemovalPath(
            session.executionTarget.workingDirectory,
          ),
        );
        if (executionPath === canonicalPath) {
          // Archived chats can restore their own execution folder through the normal restore path.
          if (session.archivedAt !== null) continue;
        } else {
          if (session.runtimeKind !== "claude" || session.externalSessionId === null) continue;
          const historyDirectory = yield* dependencies.claudeSessionMetadata
            .readWorkingDirectory(session.externalSessionId)
            .pipe(
              Effect.mapError(
                (cause) =>
                  new HostOperationError({
                    operation: "workspaceSession.archive.historyDependency",
                    message: `Cannot check history for saved chat '${runtimeTitle(session) ?? "Untitled session"}' (${session.id}). ${cause.message}`,
                    cause,
                    details: { workspaceId: candidate.workspaceId, sessionId: session.id },
                  }),
              ),
            );
          const historyPath = normalizePathForComparison(
            yield* dependencies.worktreeFiles.resolveWorktreeRemovalPath(historyDirectory),
          );
          if (historyPath !== canonicalPath) continue;
        }
        owners.push({
          workspaceId: candidate.workspaceId,
          sessionId: session.id,
          title: runtimeTitle(session) ?? "Untitled session",
        });
      }
    }
    return owners;
  });
