import {
  createWorkspaceSessionFork,
  type WorkspaceSessionForkDependencies,
} from "./workspace-session-fork";
import {
  createWorkspaceSessionStart,
  type WorkspaceSessionStartDependencies,
} from "./workspace-session-start";
import {
  createWorkspaceSessionRestore,
  type WorkspaceSessionRestoreDependencies,
} from "./workspace-session-restore";
import {
  type WorkspaceSession,
  type WorkspaceSessionArchiveInput,
  type AgentSessionModelSelection,
  type AgentSessionLiveRef,
  type WorkspaceSessionRefInput,
  type WorkspaceSessionSetTargetBranchInput,
  WORKSPACE_SESSION_UPSTREAM_TARGET_MESSAGE,
  workspaceSessionAllowsTargetBranch,
} from "@openducktor/contracts";
import { Clock, Effect } from "effect";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { TerminalService } from "../terminals/terminal-service";
import {
  planRuntimeTitleRename,
  runtimeTitleWithManualTitle,
} from "../../domain/workspace-sessions/workspace-session-title";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type { WorkspaceSettingsService } from "./workspace-settings-model";
import type { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";
import { acquireWorkspaceSessionTerminalCleanup } from "./workspace-session-terminal-cleanup";
import {
  type BrowserOwnerCleanupPort,
  closeOwnerBrowserTabs,
} from "../browser/browser-owner-cleanup";
import { createWorkspaceSessionRecordReader } from "./workspace-session-record-reader";
import {
  validateWorkspaceSessionTarget,
  type WorkspaceSessionTargetDependencies,
} from "./workspace-session-target";
import {
  readWorkspaceSessionArchivePreview,
  removeWorkspaceSessionWorktree,
} from "./workspace-session-worktree-lifecycle";

import type { TaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import { titleSyncNeedsTurn } from "./workspace-session-runtime-title-sync";
import { readWorktreeOwners, requireNoWorktreeOwners } from "./workspace-session-worktree-owners";
import { listWorkspaceSessionWorktrees } from "./workspace-session-existing-worktree";
import {
  createWorkspaceSessionCreate,
  type WorkspaceSessionCreateDependencies,
} from "./workspace-session-create";
import type { TaskOwnershipReader } from "../../ports/task-repository-ports";
import type { ClaudeSessionMetadataPort } from "../../ports/claude-session-metadata-port";

export type WorkspaceSessionServiceDependencies = WorkspaceSessionTargetDependencies &
  WorkspaceSessionCreateDependencies &
  WorkspaceSessionForkDependencies &
  WorkspaceSessionStartDependencies &
  WorkspaceSessionRestoreDependencies & {
    lifecycle: TaskSessionLifecycleCoordinator;
    operationGate: ReturnType<typeof createWorkspaceSessionOperationGate>;
    sessionTitleGate: ReturnType<typeof createWorkspaceSessionOperationGate>;
    isTitleSyncPending: (ref: AgentSessionLiveRef) => boolean;
    store: WorkspaceSessionStorePort;
    taskOwnership: TaskOwnershipReader;
    claudeSessionMetadata: ClaudeSessionMetadataPort;
    terminalService: Pick<TerminalService, "acquireWorkspaceSessionCleanup">;
    browserTabs: BrowserOwnerCleanupPort;
    settings: Pick<WorkspaceSettingsService, "getRepoConfig" | "listCustomAgentRoles">;
    live: Pick<
      AgentSessionLiveStateService,
      "resumeSession" | "read" | "stopSession" | "updateSessionTitle"
    >;
  };

export const createWorkspaceSessionService = (
  dependencies: WorkspaceSessionServiceDependencies,
) => {
  const { store, settings, live, git, operationGate, sessionTitleGate } = dependencies;
  const { scopeFor, recordFor } = createWorkspaceSessionRecordReader({ settings, git, store });
  return {
    fork: createWorkspaceSessionFork(dependencies),
    listIds: (workspaceId: string) => scopeFor(workspaceId).pipe(Effect.flatMap(store.listIds)),
    listActive: (workspaceId: string) =>
      scopeFor(workspaceId).pipe(Effect.flatMap(store.listActive)),
    listArchived: (workspaceId: string) =>
      scopeFor(workspaceId).pipe(Effect.flatMap(store.listArchived)),
    get: (input: WorkspaceSessionRefInput) =>
      recordFor(input).pipe(Effect.map(({ session }) => session)),
    create: createWorkspaceSessionCreate(dependencies),
    listWorktrees: (workspaceId: string) =>
      scopeFor(workspaceId).pipe(
        Effect.flatMap(({ repoPath }) => listWorkspaceSessionWorktrees(dependencies, repoPath)),
      ),
    start: (input: WorkspaceSessionRefInput) =>
      createWorkspaceSessionStart(dependencies)(input).pipe(
        Effect.flatMap((started) => {
          if (started.runtimeSession) return Effect.succeed(started);
          const session = started.session;
          return scopeFor(input.workspaceId).pipe(
            Effect.flatMap(({ repoPath }) =>
              live.resumeSession({
                repoPath,
                runtimeKind: session.runtimeKind,
                workingDirectory: session.executionTarget.workingDirectory,
                externalSessionId: session.externalSessionId!,
                sessionScope: { kind: "repository" },
                resumeMode: "reattach",
                model: session.selectedModel ?? undefined,
                systemPrompt: session.roleSnapshot?.systemPrompt ?? "",
              }),
            ),
            Effect.flatMap((runtimeSession) =>
              recordFor(input).pipe(Effect.map(({ session }) => ({ session, runtimeSession }))),
            ),
          );
        }),
      ),
    setDraftModel: (
      input: WorkspaceSessionRefInput & { selectedModel: AgentSessionModelSelection },
    ) =>
      operationGate.run(
        input,
        Effect.gen(function* () {
          const { ref, session } = yield* recordFor(input);
          if (session.externalSessionId !== null || session.archivedAt !== null) {
            return yield* new HostValidationError({
              field: "sessionId",
              message: "Only an active draft can change its saved model.",
            });
          }
          return yield* store.setSelectedModel({ ...ref, selectedModel: input.selectedModel });
        }),
      ),
    setTargetBranch: (input: WorkspaceSessionSetTargetBranchInput) =>
      operationGate.run(
        input,
        Effect.gen(function* () {
          const { ref, session } = yield* recordFor(input);
          // Restore of a removed worktree needs the target, so that chat can change it.
          if (session.archivedAt !== null && !hasRemovedWorktree(session)) {
            return yield* new HostValidationError({
              field: "sessionId",
              message: "Restore this Workspace Session before changing its target branch.",
            });
          }
          if (
            !workspaceSessionAllowsTargetBranch(session.executionTarget.kind, input.targetBranch)
          ) {
            return yield* new HostValidationError({
              field: "targetBranch",
              message: WORKSPACE_SESSION_UPSTREAM_TARGET_MESSAGE,
            });
          }
          return yield* store.setTargetBranch({ ...ref, targetBranch: input.targetBranch });
        }),
      ),
    rename: (input: WorkspaceSessionRefInput & { manualTitle: string | null }) =>
      operationGate.run(
        input,
        Effect.uninterruptible(
          sessionTitleGate.run(
            input,
            Effect.gen(function* () {
              const { ref, session } = yield* recordFor(input);
              if (session.archivedAt !== null)
                return yield* Effect.fail(
                  new HostValidationError({
                    message: "Restore this Workspace Session before renaming it.",
                    field: "sessionId",
                  }),
                );
              const nextTitle = runtimeTitleWithManualTitle(session, input.manualTitle);
              if (session.externalSessionId !== null && nextTitle === null) {
                return yield* Effect.fail(
                  new HostValidationError({
                    message:
                      "This chat has no generated title. Send a message first, or enter a name.",
                    field: "manualTitle",
                  }),
                );
              }
              const plannedRename =
                planRuntimeTitleRename(session, nextTitle) ??
                (titleSyncNeedsTurn(session.runtimeKind) &&
                session.externalSessionId !== null &&
                nextTitle !== null
                  ? { externalSessionId: session.externalSessionId, title: nextTitle }
                  : null);
              // Codex may write the native name before it reports a failed rename.
              // Keep the saved title so the next attach or rename can try again.
              const saved = yield* Effect.result(
                store.rename({ ...ref, manualTitle: input.manualTitle }),
              );
              if (saved._tag === "Failure") return yield* Effect.fail(saved.failure);
              if (plannedRename === null) return saved.success;
              if (
                titleSyncNeedsTurn(session.runtimeKind) &&
                dependencies.isTitleSyncPending({
                  repoPath: ref.repoPath,
                  runtimeKind: session.runtimeKind,
                  externalSessionId: plannedRename.externalSessionId,
                  workingDirectory: session.executionTarget.workingDirectory,
                })
              )
                return saved.success;
              const renamed = yield* Effect.result(
                live.updateSessionTitle({
                  repoPath: ref.repoPath,
                  runtimeKind: session.runtimeKind,
                  workingDirectory: session.executionTarget.workingDirectory,
                  ...plannedRename,
                }),
              );
              if (renamed._tag === "Success") return saved.success;
              if (session.runtimeKind === "codex") {
                return yield* new HostOperationError({
                  operation: "workspaceSession.rename",
                  message: `Could not sync this Workspace Session title to Codex. The saved title remains. Reattach this chat or rename it to retry. ${renamed.failure.message}`,
                  cause: renamed.failure,
                });
              }
              const restored = yield* Effect.result(
                store.setPersistedTitle({ ...ref, manualTitle: session.manualTitle }),
              );
              if (restored._tag === "Failure") {
                return yield* Effect.fail(
                  new HostOperationError({
                    operation: "workspaceSession.rename.persist",
                    message: `${renamed.failure.message} Restoring the saved title also failed: ${restored.failure.message}`,
                    cause: { runtimeFailure: renamed.failure, storeFailure: restored.failure },
                    details: {
                      ref,
                      runtimeFailure: renamed.failure,
                      storeFailure: restored.failure,
                    },
                  }),
                );
              }
              return yield* Effect.fail(renamed.failure);
            }),
          ),
        ),
      ),
    archivePreview: (input: WorkspaceSessionRefInput) =>
      Effect.gen(function* () {
        const { ref, session } = yield* recordFor(input);
        if (session.executionTarget.kind !== "local_worktree") {
          return yield* new HostValidationError({
            field: "sessionId",
            message: "This Workspace Session does not have a worktree.",
          });
        }
        const config = yield* settings.getRepoConfig(input.workspaceId);
        const { owners, preview } = yield* Effect.all(
          {
            owners: readWorktreeOwners(dependencies, ref, session),
            preview: readWorkspaceSessionArchivePreview(
              dependencies,
              { ...config, repoPath: ref.repoPath },
              session.executionTarget,
            ),
          },
          { concurrency: 2 },
        );
        return { ...preview, ...owners };
      }),
    archive: (input: WorkspaceSessionArchiveInput) =>
      operationGate.run(
        input,
        Effect.scoped(
          Effect.gen(function* () {
            const { ref, session } = yield* recordFor(input);
            if (session.archivedAt !== null) return session;
            let target = session.executionTarget;
            let worktreePath = target.workingDirectory;
            if (input.removeWorktree) {
              worktreePath = yield* dependencies.worktreeFiles.resolveWorktreeRemovalPath(
                target.workingDirectory,
              );
              yield* dependencies.lifecycle.acquireWorktreeLifecycle([worktreePath]);
            }
            if (input.removeWorktree) {
              if (target.kind !== "local_worktree") {
                return yield* new HostValidationError({
                  field: "removeWorktree",
                  message: "Cannot remove a repository checkout when archiving a chat.",
                });
              }
              const config = yield* settings.getRepoConfig(input.workspaceId);
              yield* requireNoWorktreeOwners(dependencies, ref, session);
              const preview = yield* readWorkspaceSessionArchivePreview(
                dependencies,
                { ...config, repoPath: ref.repoPath },
                target,
              );
              if (
                !input.worktreeConfirmation ||
                input.worktreeConfirmation.workingDirectory !== target.workingDirectory ||
                input.worktreeConfirmation.branchName !== preview.branchName
              ) {
                return yield* new HostValidationError({
                  field: "worktreeConfirmation",
                  message:
                    "The worktree or branch changed. Reopen Archive chat and confirm the current branch.",
                });
              }
              target = { ...target, branchName: preview.branchName };
            } else if (session.externalSessionId !== null) {
              if (
                target.kind !== "local_worktree" ||
                (yield* dependencies.settingsConfig.pathExists(target.workingDirectory))
              )
                yield* validateWorkspaceSessionTarget(dependencies, ref.repoPath, target);
            }
            if (session.externalSessionId !== null) {
              const runtimeRef = {
                repoPath: ref.repoPath,
                runtimeKind: session.runtimeKind,
                externalSessionId: session.externalSessionId,
                workingDirectory: target.workingDirectory,
              };
              const observed = yield* live.read(runtimeRef);
              if (observed.type === "live" && observed.session.activity !== "idle") {
                if (!input.confirmStop)
                  return yield* new HostValidationError({
                    message: "This Workspace Session is running. Confirm Stop before archiving it.",
                    field: "confirmStop",
                  });
                yield* live.stopSession(runtimeRef);
              }
            }
            yield* acquireWorkspaceSessionTerminalCleanup(dependencies.terminalService, input);
            yield* closeOwnerBrowserTabs(
              dependencies.browserTabs,
              [
                {
                  kind: "workspace_session",
                  workspaceId: input.workspaceId,
                  sessionId: input.sessionId,
                },
              ],
              "workspaceSession.archive.browser_tabs",
            );
            return yield* Effect.uninterruptible(
              Effect.gen(function* () {
                // Stop and cleanup can take time. Check again just before the files go.
                if (input.removeWorktree)
                  yield* requireNoWorktreeOwners(dependencies, ref, session);
                if (
                  input.removeWorktree &&
                  target.kind === "local_worktree" &&
                  session.executionTarget.kind === "local_worktree" &&
                  target.branchName !== session.executionTarget.branchName
                ) {
                  yield* store.setExecutionTarget({ ...ref, executionTarget: target });
                }
                const executionTarget =
                  input.removeWorktree && target.kind === "local_worktree"
                    ? yield* removeWorkspaceSessionWorktree(
                        dependencies,
                        {
                          ...(yield* settings.getRepoConfig(input.workspaceId)),
                          repoPath: ref.repoPath,
                        },
                        target,
                        worktreePath,
                      )
                    : target;
                const archived = yield* store
                  .archive({ ...ref, executionTarget, archivedAt: yield* Clock.currentTimeMillis })
                  .pipe(
                    Effect.mapError(
                      (cause) =>
                        new HostOperationError({
                          operation: "workspaceSession.archive.persist",
                          message:
                            "Could not save the archived chat. Retry archiving to finish the operation.",
                          cause,
                        }),
                    ),
                  );
                return archived;
              }),
            );
          }),
        ),
      ),
    restore: createWorkspaceSessionRestore(dependencies),
  };
};

export type WorkspaceSessionService = ReturnType<typeof createWorkspaceSessionService>;

const hasRemovedWorktree = (
  session: WorkspaceSession,
): session is WorkspaceSession & {
  executionTarget: Extract<WorkspaceSession["executionTarget"], { kind: "local_worktree" }>;
} =>
  session.executionTarget.kind === "local_worktree" &&
  session.executionTarget.worktreeState === "removed";
