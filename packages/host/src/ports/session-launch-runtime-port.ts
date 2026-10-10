import type {
  AcceptedAgentUserMessage,
  AgentSessionControlSendInput,
  AgentSessionLiveRef,
  AgentSessionLiveReadInput,
  AgentSessionLiveReadResult,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
import type { AgentSessionSendOptions } from "./agent-session-live-adapter-port";

/** Controls and observations that a launch needs from the live runtime. */
export type SessionLaunchRuntimePort = {
  sendUserMessage: (
    input: AgentSessionControlSendInput,
    options?: AgentSessionSendOptions,
  ) => Effect.Effect<AcceptedAgentUserMessage, HostError>;
  read: (input: AgentSessionLiveReadInput) => Effect.Effect<AgentSessionLiveReadResult, HostError>;
  holdWorkflowLaunch: (ref: AgentSessionLiveRef, held: boolean) => Effect.Effect<void, HostError>;
  /** Returns the id of the session notice that shows the failure, or null when none can. */
  reportLaunchFailure: (
    ref: AgentSessionLiveRef,
    message: string,
  ) => Effect.Effect<string | null, HostError>;
  stopSession: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>;
};
