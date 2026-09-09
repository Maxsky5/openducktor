import {
  agentSessionTranscriptEventSchema,
  type AgentSessionLiveRef,
} from "@openducktor/contracts";
import type { CodexLiveSessionMutation } from "@openducktor/adapters-codex-app-server";
import { Effect } from "effect";
import { type HostError, toHostOperationError } from "../../effect/host-errors";
import type { CodexSessionController } from "./codex-live-session-adapter-contract";

export const createCodexImageSettlement = (
  controller: CodexSessionController,
  runtimeId: string,
  refreshProjection: (
    events: CodexLiveSessionMutation["transcriptEvents"],
  ) => Effect.Effect<void, HostError>,
) => {
  const settle = (ref?: AgentSessionLiveRef) =>
    Effect.try({
      try: () =>
        controller
          .settleGeneratedImages(runtimeId, ref)
          .map((event) => agentSessionTranscriptEventSchema.parse(event)),
      catch: (cause) =>
        toHostOperationError(cause, "codex-live-session.settle-images", { runtimeId }),
    });
  return {
    settleSession: (ref: AgentSessionLiveRef) =>
      settle(ref).pipe(Effect.flatMap(refreshProjection)),
    settleRuntimeTranscript: () => settle(),
  };
};
