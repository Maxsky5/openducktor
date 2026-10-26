import type {
  AgentSessionControlStartInput,
  AgentSessionControlSummary,
  AgentSessionLiveRef,
  WorkspaceSessionRefInput,
  WorkspaceSessionStartResult,
} from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import { startupStep, updateStartup } from "../agent-sessions/session-startup-progress";
import { type HostError, HostOperationError, HostValidationError } from "../../effect/host-errors";
import {
  createWorkspaceSessionRecordReader,
  type WorkspaceSessionRecordReaderDependencies,
} from "./workspace-session-record-reader";
import { runtimeTitle } from "../../domain/workspace-sessions/workspace-session-title";
import {
  validateWorkspaceSessionTarget,
  type WorkspaceSessionTargetValidationDependencies,
} from "./workspace-session-target";
import { titleSyncNeedsTurn } from "./workspace-session-runtime-title-sync";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";

export type WorkspaceSessionStartDependencies = WorkspaceSessionRecordReaderDependencies &
  WorkspaceSessionTargetValidationDependencies & {
    store: Pick<WorkspaceSessionStorePort, "bindRuntimeSession">;
    runtime: Pick<RuntimeRegistryPort, "requireReady">;
    operationGate: Pick<ReturnType<typeof createWorkspaceSessionOperationGate>, "run">;
    live: Pick<AgentSessionLiveStateService, "startSession" | "releaseSession">;
    markTitleSyncPending: (ref: AgentSessionLiveRef) => void;
  };

export const createWorkspaceSessionStart = (
  dependencies: WorkspaceSessionStartDependencies,
  onStarted: (session: AgentSessionControlSummary) => Effect.Effect<void, HostError> = () =>
    Effect.void,
  workStartGuard?: import("@openducktor/core").AgentWorkStartGuard,
) => {
  const { store, settings, live, runtime, git, operationGate } = dependencies;
  const { recordFor } = createWorkspaceSessionRecordReader({ settings, git, store });
  return (input: WorkspaceSessionRefInput) =>
    operationGate.run(
      input,
      Effect.gen(function* () {
        const { ref, session } = yield* recordFor(input);
        yield* updateStartup((progress) =>
          progress.ownership({ state: "saved", target: { kind: "workspace", record: session } }),
        );
        if (session.archivedAt !== null) {
          return yield* new HostValidationError({
            field: "sessionId",
            message: "Restore this Workspace Session before sending a message.",
          });
        }
        if (session.externalSessionId !== null) {
          return { session, runtimeSession: null } satisfies WorkspaceSessionStartResult;
        }
        yield* startupStep(
          {
            id: "checkout",
            label: "Check saved checkout",
            details: [session.executionTarget.workingDirectory],
            resources: [
              {
                kind: "worktree",
                value: session.executionTarget.workingDirectory,
                state: "reused",
              },
            ],
          },
          validateWorkspaceSessionTarget(dependencies, ref.repoPath, session.executionTarget),
        );
        yield* startupStep(
          { id: "checks", label: "Check runtime availability" },
          runtime.requireReady(session.runtimeKind),
        );
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const startTitle = runtimeTitle(session);
            const startInput: AgentSessionControlStartInput &
              import("@openducktor/core").AgentWorkStartOptions = {
              repoPath: ref.repoPath,
              runtimeKind: session.runtimeKind,
              workingDirectory: session.executionTarget.workingDirectory,
              sessionScope:
                startTitle === null
                  ? { kind: "repository" }
                  : { kind: "repository", title: startTitle },
              systemPrompt: session.roleSnapshot?.systemPrompt ?? "",
            };
            if (workStartGuard) startInput.workStartGuard = workStartGuard;
            if (session.selectedModel !== null) startInput.model = session.selectedModel;
            const runtimeSession = yield* startupStep(
              { id: "prepare", label: "Prepare native session" },
              live.startSession(startInput),
            );
            const saved = yield* Effect.exit(
              Effect.gen(function* () {
                if (
                  runtimeSession.runtimeKind !== session.runtimeKind ||
                  runtimeSession.workingDirectory !== session.executionTarget.workingDirectory
                ) {
                  return yield* new HostValidationError({
                    field: "runtimeSession",
                    message:
                      "Runtime returned a different Workspace Session identity or directory.",
                  });
                }
                yield* onStarted(runtimeSession);
                return yield* startupStep(
                  { id: "save", label: "Save native session identity" },
                  store.bindRuntimeSession({
                    ...ref,
                    externalSessionId: runtimeSession.externalSessionId,
                  }),
                );
              }),
            );
            if (Exit.isSuccess(saved)) {
              yield* updateStartup((progress) =>
                progress.ownership({
                  state: "saved",
                  target: { kind: "workspace", record: saved.value, runtimeSession },
                }),
              );
              if (titleSyncNeedsTurn(session.runtimeKind))
                dependencies.markTitleSyncPending({
                  repoPath: ref.repoPath,
                  runtimeKind: session.runtimeKind,
                  externalSessionId: runtimeSession.externalSessionId,
                  workingDirectory: runtimeSession.workingDirectory,
                });
              return {
                session: saved.value,
                runtimeSession,
              } satisfies WorkspaceSessionStartResult;
            }
            const released = yield* Effect.exit(
              live.releaseSession({
                repoPath: ref.repoPath,
                runtimeKind: runtimeSession.runtimeKind,
                externalSessionId: runtimeSession.externalSessionId,
                workingDirectory: runtimeSession.workingDirectory,
              }),
            );
            const releaseMessage = Exit.isFailure(released)
              ? `\nLocal runtime release also failed: ${Cause.pretty(released.cause)}`
              : "";
            return yield* new HostOperationError({
              operation: "workspaceSession.start.persist",
              message: `Workspace Session start failed: ${Cause.pretty(saved.cause)}\nRuntime history ${runtimeSession.externalSessionId} was retained.${releaseMessage}`,
              cause: { save: saved.cause, release: released },
            });
          }),
        );
      }),
    );
};
