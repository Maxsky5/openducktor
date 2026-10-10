import type {
  AgentSessionControlSendInput,
  AgentSessionControlSummary,
  AgentSessionLiveRef,
  AgentSessionUserMessagePart,
  SessionLaunchResult,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";

/** The result fields that `run` sets. The launch service owns the other shared fields. */
type SessionLaunchResultFields<Result extends SessionLaunchResult> = Partial<
  Pick<SessionLaunchResult, "model"> & Omit<Result, keyof SessionLaunchResult>
>;

export type SessionLaunchContext<Request, Result extends SessionLaunchResult> = {
  readonly request: Request;
  /** Stop cancels a launch that targets the stopped session. */
  targetSession: (ref: AgentSessionLiveRef) => void;
  /**
   * Records a session that this launch created. Settlement stops it when the launch is canceled.
   * With `hold`, the session shows as running until the launch settles, so startup idle events
   * cannot end the first turn before the first instruction arrives.
   */
  createdSession: (
    repoPath: string,
    session: AgentSessionControlSummary,
    options: { hold: boolean },
  ) => Effect.Effect<void, HostError>;
  /** The task or workspace already owns a reused session. */
  reusedSession: (repoPath: string, session: AgentSessionControlSummary) => void;
  ownershipSaved: () => void;
  setResultFields: (fields: SessionLaunchResultFields<Result>) => void;
  skip: (reason: string) => void;
  checkCanceled: () => Effect.Effect<void, HostError>;
  /** Stops the session in launch cleanup, so settlement does not stop it again. */
  stopSession: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>;
  /**
   * Sends the first instruction. `instruction` holds the request parts before attachment
   * resolution. When the runtime did not get the send or rejected it, the failed launch returns
   * `instruction` as `unsentInstruction`.
   */
  send: (
    input: AgentSessionControlSendInput,
    instruction: AgentSessionUserMessagePart[],
  ) => Effect.Effect<void, HostError>;
};

export type SessionLaunchService<Request, Result extends SessionLaunchResult> = {
  launch: (request: Request) => Effect.Effect<Result, HostError>;
  /** Cancels active launches that target this session. It does not wait for them. */
  cancelSessionLaunches: (ref: AgentSessionLiveRef) => void;
  shutdown: () => Effect.Effect<void>;
};

/** The controls that Stop and host shutdown use on every launch service. */
export type SessionLaunchControls = Pick<
  SessionLaunchService<never, never>,
  "cancelSessionLaunches" | "shutdown"
>;
