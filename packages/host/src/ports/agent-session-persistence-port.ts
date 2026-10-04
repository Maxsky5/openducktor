import type { AgentSessionLiveEnvelope } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";

export type AgentSessionPersistencePort = {
  observe(
    envelope: AgentSessionLiveEnvelope,
    provenance?: "baseline" | "live",
  ): Effect.Effect<void, HostError>;
};
