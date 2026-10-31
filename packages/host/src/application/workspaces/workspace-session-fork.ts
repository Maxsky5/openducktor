import {
  WORKSPACE_SESSION_MANUAL_TITLE_LIMIT,
  WORKSPACE_SESSION_UPSTREAM_TARGET_MESSAGE,
  type AgentSessionControlSummary,
  type AgentSessionModelSelection,
  type AgentSessionLiveRef,
  type WorkspaceSession,
  type WorkspaceSessionExecutionTarget,
  type WorkspaceSessionForkInput,
  type WorkspaceSessionForkResult,
  effectiveWorkspaceSessionTargetBranch,
  workspaceSessionAllowsTargetBranch,
} from "@openducktor/contracts";
import { Cause, Clock, Effect, Exit } from "effect";
import {
  startupStep,
  updateStartup,
  stopStartupSession,
} from "../agent-sessions/session-startup-progress";
import {
  type HostError,
  HostOperationError,
  HostValidationError,
  toHostOperationError,
} from "../../effect/host-errors";
import { runtimeTitle } from "../../domain/workspace-sessions/workspace-session-title";
import {
  createWorkspaceSessionRecordReader,
  type WorkspaceSessionRecordReaderDependencies,
} from "./workspace-session-record-reader";
import {
  validateWorkspaceSessionTarget,
  withWorkspaceSessionTarget,
  type WorkspaceSessionTargetCreationDependencies,
  type WorkspaceSessionTargetValidationDependencies,
} from "./workspace-session-target";
import { titleSyncNeedsTurn } from "./workspace-session-runtime-title-sync";
import type { GitPort } from "../../ports/git-port";
import type { RuntimeAdmissionPort } from "../../ports/runtime-admission-port";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { WorktreeFilePort } from "../../ports/worktree-file-port";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type { createAgentSessionCommandService } from "../agent-sessions/agent-session-command-service";
import type { TaskSessionLifecycleCoordinator } from "../tasks/worktrees/task-session-lifecycle-coordinator";
import type { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";

export type WorkspaceSessionForkDependencies = WorkspaceSessionRecordReaderDependencies &
  WorkspaceSessionTargetCreationDependencies &
  WorkspaceSessionTargetValidationDependencies & {
    git: Pick<GitPort, "getCurrentBranch">;
    worktreeFiles: Pick<WorktreeFilePort, "resolveWorktreeRemovalPath">;
    store: Pick<WorkspaceSessionStorePort, "create">;
    lifecycle: Pick<TaskSessionLifecycleCoordinator, "runWorktreeRead">;
    operationGate: Pick<ReturnType<typeof createWorkspaceSessionOperationGate>, "run">;
    runtimeAdmission: Pick<RuntimeAdmissionPort, "admit">;
    runForkSourceOperation: ReturnType<
      typeof createAgentSessionCommandService
    >["runForkSourceOperation"];
    live: Pick<AgentSessionLiveStateService, "forkSession" | "stopSession" | "releaseSession">;
    markTitleSyncPending: (ref: AgentSessionLiveRef) => void;
  };

/** Hold the source checkout until the fork is saved so archive cannot remove it mid-fork. */
export const createWorkspaceSessionFork = (deps: WorkspaceSessionForkDependencies) => {
  const { recordFor } = createWorkspaceSessionRecordReader(deps);
  return (input: WorkspaceSessionForkInput) =>
    Effect.gen(function* () {
      const initial = yield* recordFor(input);
      if (initial.session.externalSessionId === null)
        return yield* new HostValidationError({
          field: "sessionId",
          message: "Open a chat with a completed reply before forking.",
        });
      const sourceRef = {
        repoPath: initial.ref.repoPath,
        runtimeKind: initial.session.runtimeKind,
        workingDirectory: initial.session.executionTarget.workingDirectory,
        externalSessionId: initial.session.externalSessionId,
        sessionScope: { kind: "repository" as const },
      };
      return yield* deps.runForkSourceOperation(
        sourceRef,
        deps.operationGate.run(
          input,
          Effect.gen(function* () {
            const { ref, session: source } = yield* recordFor(input);
            if (source.archivedAt !== null || source.externalSessionId === null)
              return yield* new HostValidationError({
                field: "sessionId",
                message: "Open an active chat with a completed reply before forking.",
              });
            if (
              source.externalSessionId !== sourceRef.externalSessionId ||
              source.runtimeKind !== sourceRef.runtimeKind ||
              source.executionTarget.workingDirectory !== sourceRef.workingDirectory
            )
              return yield* new HostValidationError({
                field: "sessionId",
                message: "The source chat changed while the fork waited. Reopen it and retry.",
              });
            const parentExternalSessionId = source.externalSessionId;
            const sourcePath =
              source.executionTarget.kind === "local_worktree"
                ? yield* deps.worktreeFiles.resolveWorktreeRemovalPath(
                    source.executionTarget.workingDirectory,
                  )
                : yield* deps.git.canonicalizePath(source.executionTarget.workingDirectory);
            return yield* deps.runtimeAdmission.admit(
              source.runtimeKind,
              deps.lifecycle.runWorktreeRead(
                sourcePath,
                Effect.gen(function* () {
                  yield* validateWorkspaceSessionTarget(deps, ref.repoPath, source.executionTarget);
                  if (!source.selectedModel)
                    return yield* new HostValidationError({
                      field: "model",
                      message:
                        "The source chat has no accepted model settings. Select its model before forking.",
                    });
                  const model = source.selectedModel;
                  const id = crypto.randomUUID();
                  const create = (
                    target: WorkspaceSessionExecutionTarget,
                    retain: () => void,
                    targetBranch = source.targetBranch,
                  ) =>
                    forkAndSave(deps, {
                      workspaceId: input.workspaceId,
                      repoPath: ref.repoPath,
                      id,
                      source,
                      target,
                      targetBranch,
                      parentExternalSessionId,
                      model,
                      forkPoint: input.forkPoint,
                      retain,
                    });
                  if (input.destination.kind === "same_folder")
                    return yield* create({ ...source.executionTarget }, () => {});
                  const config = yield* deps.settings.getRepoConfig(input.workspaceId);
                  const targetBranch = effectiveWorkspaceSessionTargetBranch(
                    "local_worktree",
                    source.targetBranch,
                    config.defaultTargetBranch,
                  );
                  if (
                    targetBranch === null ||
                    !workspaceSessionAllowsTargetBranch("local_worktree", targetBranch)
                  )
                    return yield* new HostValidationError({
                      field: "targetBranch",
                      message: WORKSPACE_SESSION_UPSTREAM_TARGET_MESSAGE,
                    });
                  const head = yield* deps.git.getCurrentBranch(
                    source.executionTarget.workingDirectory,
                  );
                  if (!head.revision)
                    return yield* new HostValidationError({
                      field: "workingDirectory",
                      message:
                        "The source folder has no committed HEAD. Commit its files before creating a fork worktree.",
                    });
                  return yield* withWorkspaceSessionTarget(
                    deps,
                    {
                      owner: { workspaceId: input.workspaceId, sessionId: id },
                      repoConfig: { ...config, repoPath: ref.repoPath },
                      destination: {
                        location: "local_worktree",
                        worktree: {
                          mode: "from_name",
                          name: input.destination.name,
                          branchName: input.destination.branchName,
                        },
                      },
                      targetBranch,
                      startPoint: head.revision,
                      rollbackMode: "all_owned",
                    },
                    (target, retain) => create(target, retain, targetBranch),
                  );
                }),
              ),
            );
          }),
        ),
      );
    });
};

const forkAndSave = (
  deps: WorkspaceSessionForkDependencies,
  input: {
    workspaceId: string;
    repoPath: string;
    id: string;
    source: WorkspaceSession;
    target: WorkspaceSessionExecutionTarget;
    targetBranch: WorkspaceSession["targetBranch"];
    parentExternalSessionId: string;
    model: AgentSessionModelSelection;
    forkPoint: WorkspaceSessionForkInput["forkPoint"];
    retain: () => void;
  },
): Effect.Effect<WorkspaceSessionForkResult, HostError> =>
  Effect.uninterruptible(
    Effect.gen(function* () {
      const manualTitle = forkTitle(input.source);
      const child = yield* startupStep(
        { id: "prepare", label: "Fork native session" },
        deps.live.forkSession({
          repoPath: input.repoPath,
          runtimeKind: input.source.runtimeKind,
          sourceWorkingDirectory: input.source.executionTarget.workingDirectory,
          workingDirectory: input.target.workingDirectory,
          parentExternalSessionId: input.parentExternalSessionId,
          forkPoint: input.forkPoint,
          sessionScope:
            manualTitle === null
              ? { kind: "repository" }
              : { kind: "repository", title: manualTitle },
          systemPrompt: input.source.roleSnapshot?.systemPrompt ?? "",
          model: input.model,
        }),
      );
      const saved = yield* Effect.exit(
        Effect.gen(function* () {
          if (
            child.externalSessionId === input.parentExternalSessionId ||
            child.runtimeKind !== input.source.runtimeKind ||
            child.workingDirectory !== input.target.workingDirectory ||
            child.status !== "idle"
          )
            return yield* new HostValidationError({
              field: "runtimeSession",
              message:
                "The runtime did not return a distinct idle fork in the selected folder. Reopen the source chat and retry.",
            });
          const now = yield* Clock.currentTimeMillis;
          const record: WorkspaceSession = {
            id: input.id,
            runtimeKind: input.source.runtimeKind,
            externalSessionId: child.externalSessionId,
            executionTarget: input.target,
            roleSnapshot: input.source.roleSnapshot,
            selectedModel: input.model,
            generatedTitle: null,
            manualTitle,
            targetBranch: input.targetBranch,
            createdAt: now,
            updatedAt: now,
            archivedAt: null,
          };
          return yield* startupStep(
            { id: "save", label: "Save forked workspace session" },
            deps.store
              .create({
                workspaceId: input.workspaceId,
                repoPath: input.repoPath,
                session: record,
              })
              .pipe(
                Effect.mapError((cause) =>
                  toHostOperationError(cause, "workspaceSession.fork.persist"),
                ),
              ),
          );
        }),
      );
      if (Exit.isSuccess(saved)) {
        input.retain();
        yield* updateStartup((progress) =>
          progress.ownership({
            state: "saved",
            target: { kind: "workspace", record: saved.value, runtimeSession: child },
          }),
        );
        if (titleSyncNeedsTurn(input.source.runtimeKind))
          deps.markTitleSyncPending(toRef(input.repoPath, child));
        return { record: saved.value, runtimeSession: child };
      }
      if (child.externalSessionId === input.parentExternalSessionId)
        return yield* Effect.failCause(saved.cause);
      yield* updateStartup((progress) => {
        progress.phase("settling");
        progress.ownership({ state: "unknown" });
        progress.step({
          id: "cleanup",
          label: "Stop unused native fork",
          state: "running",
          details: [child.externalSessionId],
        });
      });
      const childRef = toRef(input.repoPath, child);
      const stopped = yield* Effect.exit(
        stopStartupSession(childRef, deps.live.stopSession(childRef)),
      );
      if (Exit.isFailure(stopped)) {
        input.retain();
        yield* updateStartup((progress) =>
          progress.step({
            id: "cleanup",
            label: "Stop unused native fork",
            state: "failed",
            details: [
              "The native fork did not confirm Stop. Keep its checkout until Stop succeeds.",
            ],
            resources: [
              {
                kind: "worktree",
                value: input.target.workingDirectory,
                state: "retained",
                nextAction: `Stop native session ${child.externalSessionId} before removing this checkout.`,
              },
            ],
          }),
        );
      }
      const released = yield* Effect.exit(deps.live.releaseSession(childRef));
      const failures = [stopped, released].flatMap((result) =>
        Exit.isFailure(result) ? [result.cause] : [],
      );
      if (failures.length === 0)
        yield* updateStartup((progress) =>
          progress.step({
            id: "cleanup",
            label: "Stop unused native fork",
            state: "completed",
            details: ["The unused fork was stopped and released. Native history can remain."],
          }),
        );
      let message = `Could not save the fork: ${Cause.pretty(saved.cause)}`;
      if (failures.length > 0)
        message += ` Cleanup of runtime session ${child.externalSessionId} also failed: ${failures.map(Cause.pretty).join("; ")}.`;
      else message += " The unused fork was stopped and released.";
      message += ` Native history for runtime session '${child.externalSessionId}' can remain. Inspect that conversation before retrying.`;
      return yield* new HostOperationError({
        operation: "workspaceSession.fork.persist",
        message,
        cause: { creation: saved.cause, cleanup: failures },
        details: { childRef },
      });
    }),
  );

const forkTitle = (source: WorkspaceSession): string | null => {
  const title = runtimeTitle(source);
  if (title === null) return null;
  const suffix = " (fork)";
  let prefix = "";
  for (const character of title) {
    if (prefix.length + character.length > WORKSPACE_SESSION_MANUAL_TITLE_LIMIT - suffix.length)
      break;
    prefix += character;
  }
  return prefix.trimEnd() + suffix;
};

const toRef = (repoPath: string, summary: AgentSessionControlSummary) => ({
  repoPath,
  runtimeKind: summary.runtimeKind,
  workingDirectory: summary.workingDirectory,
  externalSessionId: summary.externalSessionId,
});
