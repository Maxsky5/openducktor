import type {
  AcceptedAgentUserMessage,
  AgentSessionControlResumeInput,
  AgentSessionControlSendInput,
  AgentSessionControlSummary,
  AgentSessionControlUpdateModelInput,
  AgentSessionLiveRef,
  AgentSessionModelSettings,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";

export type PreparedSessionResume = {
  input: AgentSessionControlResumeInput;
  save(summary: AgentSessionControlSummary): Effect.Effect<void, HostError>;
};

export type PreparedSessionModelUpdate = {
  input: AgentSessionControlUpdateModelInput;
  previousModel: AgentSessionModelSettings | null;
  /** A successful save returns publication work. Publication cannot undo the save. */
  save: Effect.Effect<Effect.Effect<void, HostError>, HostError>;
};

/** Internal owner policy. Only the command module runs native controls. */
export type AgentSessionOperationPolicy = {
  run<A, E, R>(
    ref: AgentSessionLiveRef,
    operation: string,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | HostError, R>;
  /** Runs a send command. Send-aware policies mark the send as in flight. */
  runSend<A, E, R>(
    ref: AgentSessionLiveRef,
    effect: Effect.Effect<A, E, R>,
  ): Effect.Effect<A, E | HostError, R>;
  prepareResume(
    input: AgentSessionControlResumeInput,
  ): Effect.Effect<PreparedSessionResume, HostError>;
  prepareSend(
    input: AgentSessionControlSendInput,
  ): Effect.Effect<AgentSessionControlSendInput, HostError>;
  recordAcceptedMessage(
    ref: AgentSessionLiveRef,
    accepted: AcceptedAgentUserMessage,
  ): Effect.Effect<void, HostError>;
  prepareModelUpdate(
    input: AgentSessionControlUpdateModelInput,
  ): Effect.Effect<PreparedSessionModelUpdate, HostError>;
  validateRef(ref: AgentSessionLiveRef): Effect.Effect<void, HostError>;
};
