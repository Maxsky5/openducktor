import type {
  AgentSessionControlStartInput,
  AgentSessionControlSummary,
  AgentSessionLiveRef,
  WorkspaceSession,
  WorkspaceSessionRefInput,
  WorkspaceSessionStartResult,
} from "@openducktor/contracts";
import type { AgentWorkStartGuard, AgentWorkStartOptions } from "@openducktor/core";
import { Cause, Effect, Exit } from "effect";
import { startupStep, updateStartup } from "../agent-sessions/session-startup-progress";
import { existingCheckoutStepMeta } from "../agent-sessions/worktree-setup-plan";
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
import { syncsTitleAfterTurn } from "./workspace-session-runtime-title-sync";
import type { WorkspaceSessionStorePort } from "../../ports/workspace-session-store-port";
import type { RuntimeRegistryPort } from "../../ports/runtime-registry-port";
import type { AgentSessionLiveStateService } from "../agent-sessions/agent-session-live-state-service";
import type { createWorkspaceSessionOperationGate } from "./workspace-session-operation-gate";
import {
  resolveRuntimeOwnershipScope,
  type RuntimeOwnershipScopeDependencies,
} from "./workspace-session-import-owners";

export type WorkspaceSessionStartDependencies = WorkspaceSessionRecordReaderDependencies &
  RuntimeOwnershipScopeDependencies &
  WorkspaceSessionTargetValidationDependencies & {
    store: Pick<WorkspaceSessionStorePort, "bindRuntimeSession">;
    runtime: Pick<RuntimeRegistryPort, "requireReady">;
    operationGate: Pick<ReturnType<typeof createWorkspaceSessionOperationGate>, "run">;
    live: Pick<AgentSessionLiveStateService, "startSession" | "releaseSession">;
    markTitleSyncPending: (ref: AgentSessionLiveRef) => void;
  };

export type WorkspaceSessionBindOptions = {
  beforeBind?: () => Effect.Effect<void, HostError>;
  onBound?: (
    record: WorkspaceSession,
    session: AgentSessionControlSummary,
  ) => Effect.Effect<void, HostError>;
  workStartGuard?: AgentWorkStartGuard;
};

const runStartAndBind = (
  dependencies: WorkspaceSessionStartDependencies,
  input: WorkspaceSessionRefInput,
  preflight: boolean,
  options?: WorkspaceSessionBindOptions,
) => {
  const { store, settings, live, runtime, git, operationGate } = dependencies;
  const { recordFor } = createWorkspaceSessionRecordReader({ settings, git, store });
  return operationGate.run(
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
      if (preflight) {
        const checkoutMeta = existingCheckoutStepMeta(
          session.executionTarget.workingDirectory,
          session.executionTarget.kind === "local_repo_root",
          "Reuse existing worktree",
        );
        yield* updateStartup((progress) =>
          progress.plan([
            {
              id: checkoutMeta.id,
              label: checkoutMeta.label,
              state: "pending",
              details: checkoutMeta.details,
            },
            { id: "checks", label: "Check runtime availability", state: "pending" },
            { id: "prepare", label: "Start session", state: "pending" },
          ]),
        );
        yield* startupStep(
          checkoutMeta,
          validateWorkspaceSessionTarget(dependencies, ref.repoPath, session.executionTarget),
        );
        yield* startupStep(
          { id: "checks", label: "Check runtime availability" },
          runtime.requireReady(session.runtimeKind),
        );
      }
      return yield* Effect.uninterruptible(
        Effect.gen(function* () {
          const startTitle = runtimeTitle(session);
          const startInput: AgentSessionControlStartInput & AgentWorkStartOptions = {
            repoPath: ref.repoPath,
            runtimeKind: session.runtimeKind,
            workingDirectory: session.executionTarget.workingDirectory,
            sessionScope:
              startTitle === null
                ? { kind: "repository", workspaceId: ref.workspaceId }
                : { kind: "repository", workspaceId: ref.workspaceId, title: startTitle },
            systemPrompt: session.roleSnapshot?.systemPrompt ?? "",
          };
          if (options?.workStartGuard) {
            startInput.workStartGuard = options.workStartGuard;
          }
          if (session.selectedModel !== null) startInput.model = session.selectedModel;
          const runtimeSession = yield* startupStep(
            { id: "prepare", label: "Start session" },
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
                  message: "Runtime returned a different Workspace Session identity or directory.",
                });
              }
              if (options?.beforeBind) {
                yield* options.beforeBind();
              }
              const ownershipScope = yield* resolveRuntimeOwnershipScope({ settings, git }, ref);
              return yield* startupStep(
                { id: "bind", label: "Save native session identity" },
                store.bindRuntimeSession({
                  ...ref,
                  ownershipScope,
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
            if (options?.onBound) {
              yield* options.onBound(saved.value, runtimeSession);
            }
            if (syncsTitleAfterTurn(session.runtimeKind))
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

/** Public `workspace_session_start`: runs target & runtime preflight, then binds a runtime session. */
export const createWorkspaceSessionStart =
  (dependencies: WorkspaceSessionStartDependencies) => (input: WorkspaceSessionRefInput) =>
    runStartAndBind(dependencies, input, true);

/** Internal bind entry point for `workspace_session_launch`, whose preflight already ran. */
export const createWorkspaceSessionBind =
  (dependencies: WorkspaceSessionStartDependencies) =>
  (input: WorkspaceSessionRefInput, options?: WorkspaceSessionBindOptions) =>
    runStartAndBind(dependencies, input, false, options);
