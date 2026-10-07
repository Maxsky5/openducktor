import type {
  AcceptedAgentUserMessage,
  AgentSessionControlSendInput,
  AgentSessionLiveRef,
  AgentSessionLiveReadInput,
  AgentSessionLiveReadResult,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";

/** Controls and observations that a launch needs from the live runtime. */
export type SessionLaunchRuntimePort = {
  sendUserMessage: (
    input: AgentSessionControlSendInput,
  ) => Effect.Effect<AcceptedAgentUserMessage, HostError>;
  read: (input: AgentSessionLiveReadInput) => Effect.Effect<AgentSessionLiveReadResult, HostError>;
  holdWorkflowLaunch: (ref: AgentSessionLiveRef, held: boolean) => Effect.Effect<void, HostError>;
  stopSession: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>;
};
