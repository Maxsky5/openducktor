import type { AgentSessionLiveEnvelope, AgentSessionLiveRef } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";

/** Saves or publishes only while the captured runtime and session still own the callback. */
export type SpeedCommit = <A, E>(write: Effect.Effect<A, E>) => Effect.Effect<A, E | HostError>;

export type AgentSessionPersistencePort = {
  recordSpeedChoice?: (
    ref: AgentSessionLiveRef,
    choice: string | null,
    commit: SpeedCommit,
    model?: import("@openducktor/contracts").AgentSessionModelSettings,
    previousChoice?: string | null,
  ) => Effect.Effect<Effect.Effect<void, HostError>, HostError>;
  observe(
    envelope: AgentSessionLiveEnvelope,
    provenance?: "baseline" | "live",
  ): Effect.Effect<void, HostError>;
};
