import type { AgentSessionLiveRef } from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
import type {
  AgentSessionLiveAdapterMutation,
  AgentSessionLiveAdapterPort,
} from "./agent-session-live-adapter-port";

/** Runtime-starter boundary for registering and releasing ephemeral live projections. */
export type RuntimeLiveSessionLifecyclePort = {
  readonly registerRuntimeAdapter: (
    adapter: AgentSessionLiveAdapterPort,
  ) => Effect.Effect<void, HostError>;
  readonly releaseRuntime: (
    runtimeId: string,
  ) => Effect.Effect<ReadonlyArray<AgentSessionLiveRef>, HostError>;
  readonly runAdapterMutation: <Success>(
    mutation: Effect.Effect<AgentSessionLiveAdapterMutation<Success>, HostError>,
  ) => Effect.Effect<Success, HostError>;
};

export type PreparedRuntimeLiveSessionAdapter = {
  readonly adapter: AgentSessionLiveAdapterPort;
  /** Starts ordered forwarding only after the retained projection is registered. */
  readonly startForwarding: () => Effect.Effect<void, HostError>;
  /** Releases adapter-local observation/state when startup fails before registration. */
  readonly discard: () => Effect.Effect<void, HostError>;
};
