import { Effect } from "effect";
import type { HostError, HostOperationErrorAggregate } from "../../effect/host-errors";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";
import type {
  CodexSessionController,
  CreateCodexLiveSessionAdapterPreparerInput,
} from "./codex-live-session-adapter-contract";

export const createCodexSessionSettingsControls = ({
  controller,
  resolveRuntimePolicy,
  sessionError,
  refreshProjection,
}: {
  controller: CodexSessionController;
  resolveRuntimePolicy: CreateCodexLiveSessionAdapterPreparerInput["resolveRuntimePolicy"];
  sessionError: (operation: string, id: string) => (cause: unknown) => HostOperationErrorAggregate;
  refreshProjection: () => Effect.Effect<void, HostError>;
}): Pick<
  AgentSessionRuntimeAdapterPort,
  "holdSessionTurns" | "setSessionSpeedState" | "updateSessionSpeed" | "updateSessionModel"
> => ({
  holdSessionTurns: (input) =>
    Effect.gen(function* () {
      const policy = yield* resolveRuntimePolicy(input.sessionScope);
      const release = yield* Effect.tryPromise({
        try: () =>
          controller.holdSessionTurns(input, {
            ...input,
            runtimeKind: "codex",
            runtimePolicy: { kind: "codex", policy },
          }),
        catch: sessionError("codex-live-session.hold-session-turns", input.externalSessionId),
      });
      return Effect.tryPromise({
        try: release,
        catch: sessionError("codex-live-session.release-session-turns", input.externalSessionId),
      });
    }),
  setSessionSpeedState: (input, speed) =>
    Effect.tryPromise({
      try: async () => controller.setSessionSpeedState(input, speed),
      catch: sessionError("codex-live-session.set-speed-state", input.externalSessionId),
    }).pipe(Effect.tap(() => refreshProjection())),
  updateSessionSpeed: (input) =>
    Effect.tryPromise({
      try: () => controller.updateSessionSpeed(input),
      catch: sessionError("codex-live-session.update-speed", input.externalSessionId),
    }),
  updateSessionModel: (input) =>
    Effect.tryPromise({
      try: async () => {
        const policy = await Effect.runPromise(resolveRuntimePolicy({ kind: "repository" }));
        return controller.updateSessionModel(input, {
          repoPath: input.repoPath,
          runtimeKind: "codex",
          workingDirectory: input.workingDirectory,
          externalSessionId: input.externalSessionId,
          runtimePolicy: { kind: "codex", policy },
        });
      },
      catch: sessionError("codex-live-session.update-session-model", input.externalSessionId),
    }).pipe(Effect.tap(() => refreshProjection())),
});
