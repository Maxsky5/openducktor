import type {
  AgentSessionControlStartInput,
  AgentSessionControlSummary,
  WorkspaceSessionRefInput,
  WorkspaceSessionStartResult,
} from "@openducktor/contracts";
import { Cause, Effect, Exit } from "effect";
import { type HostError, HostOperationError, HostValidationError } from "../../effect/host-errors";
import type { WorkspaceSessionServiceDependencies } from "./workspace-session-service";
import { createWorkspaceSessionRecordReader } from "./workspace-session-record-reader";
import { runtimeTitle } from "../../domain/workspace-sessions/workspace-session-title";
import { validateWorkspaceSessionTarget } from "./workspace-session-target";

export const createWorkspaceSessionStart = (
  dependencies: WorkspaceSessionServiceDependencies,
  onStarted: (session: AgentSessionControlSummary) => Effect.Effect<void, HostError> = () =>
    Effect.void,
) => {
  const { store, settings, live, runtime, git, operationGate } = dependencies;
  const { recordFor } = createWorkspaceSessionRecordReader({ settings, git, store });
  return (input: WorkspaceSessionRefInput) =>
    operationGate.run(
      input,
      Effect.gen(function* () {
        const { ref, session } = yield* recordFor(input);
        if (session.archivedAt !== null) {
          return yield* new HostValidationError({
            field: "sessionId",
            message: "Restore this Workspace Session before sending a message.",
          });
        }
        if (session.externalSessionId !== null) {
          return { session, runtimeSession: null } satisfies WorkspaceSessionStartResult;
        }
        yield* validateWorkspaceSessionTarget(dependencies, ref.repoPath, session.executionTarget);
        yield* runtime.requireReady(session.runtimeKind);
        return yield* Effect.uninterruptible(
          Effect.gen(function* () {
            const startTitle = runtimeTitle(session);
            const startInput: AgentSessionControlStartInput = {
              repoPath: ref.repoPath,
              runtimeKind: session.runtimeKind,
              workingDirectory: session.executionTarget.workingDirectory,
              sessionScope:
                startTitle === null
                  ? { kind: "repository" }
                  : { kind: "repository", title: startTitle },
              systemPrompt: session.roleSnapshot?.systemPrompt ?? "",
            };
            if (session.selectedModel !== null) startInput.model = session.selectedModel;
            const runtimeSession = yield* live.startSession(startInput);
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
                return yield* store.bindRuntimeSession({
                  ...ref,
                  externalSessionId: runtimeSession.externalSessionId,
                });
              }),
            );
            if (Exit.isSuccess(saved)) {
              if (session.runtimeKind === "codex")
                dependencies.markCodexTitleSyncPending({
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
