import type { AgentSessionLiveRef } from "@openducktor/contracts";
import { Effect } from "effect";
import type { HostError, HostOperationErrorAggregate } from "../../effect/host-errors";
import type { AgentSessionRuntimeAdapterPort } from "../../ports/agent-session-live-adapter-port";
import { messageAcceptedFailure } from "../../ports/agent-session-send-error";
import { stopCodexSession, type CodexSessionStopInput } from "../codex/codex-session-stop";
import type { CodexSessionController } from "./codex-live-session-adapter-contract";

/** The goal controls of the Codex live-session adapter. Codex reports each goal change live. */
export const createCodexGoalControls = ({
  controller,
  refreshProjection,
  sessionError,
  stopTarget,
}: {
  readonly controller: Pick<CodexSessionController, "controlGoal" | "pauseGoalForStop">;
  readonly stopTarget: Pick<
    CodexSessionStopInput,
    "codexAppServer" | "directoriesMatch" | "runtimeId"
  >;
  readonly refreshProjection: () => Effect.Effect<void, HostError>;
  readonly sessionError: (
    operation: string,
    externalSessionId: string,
  ) => (cause: unknown) => HostOperationErrorAggregate;
}) => ({
  controlGoal: ((input, options) =>
    Effect.tryPromise({
      try: () => controller.controlGoal(input, options),
      catch: sessionError("codex-live-session.control-goal", input.externalSessionId),
    }).pipe(
      // A failed publication keeps the action accepted, so the user does not repeat it.
      Effect.tap((accepted) =>
        refreshProjection().pipe(
          Effect.mapError(messageAcceptedFailure(input, accepted, "live_update")),
        ),
      ),
    )) satisfies AgentSessionRuntimeAdapterPort["controlGoal"],
  /**
   * Interrupts the running turn of a session. An interrupt does not pause a Codex goal, so Stop
   * pauses an active goal first. A failed pause fails Stop.
   */
  stopTurn: (input: AgentSessionLiveRef) =>
    Effect.tryPromise({
      try: () => controller.pauseGoalForStop(input),
      catch: sessionError("codex-live-session.pause-goal-for-stop", input.externalSessionId),
    }).pipe(
      Effect.andThen(
        stopCodexSession({
          ...stopTarget,
          externalSessionId: input.externalSessionId,
          workingDirectory: input.workingDirectory,
        }),
      ),
    ),
});
