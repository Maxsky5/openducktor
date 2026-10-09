import type {
  AgentSessionControlSendInput,
  AgentSessionLiveRef,
  SessionLaunchState,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type { SessionLaunchRuntimePort } from "../../ports/session-launch-runtime-port";

export type SessionLaunchSendInput = AgentSessionControlSendInput & { speed?: string | null };

export type SessionLaunchRef = { launchAttemptId: string; workspaceId: string; repoPath: string };
export type SessionLaunchInitial<State extends SessionLaunchState> = {
  snapshot: State;
  target?: AgentSessionLiveRef;
};
/** Owner data cannot change worker, acceptance, or completion state. */
export type SessionLaunchOwnerState<State extends SessionLaunchState> = Partial<
  Pick<SessionLaunchState, "repoPath" | "model"> & Omit<State, keyof SessionLaunchState>
>;

export type SessionLaunchContext<Request, State extends SessionLaunchState> = {
  readonly request: Request;
  readonly snapshot: Readonly<State>;
  readonly sendInput: SessionLaunchSendInput | undefined;
  updateOwner: (state: SessionLaunchOwnerState<State>) => void;
  retainSession: (session: NonNullable<SessionLaunchState["session"]>) => void;
  retainInstruction: (input: SessionLaunchSendInput) => void;
  targetSession: (ref: AgentSessionLiveRef) => void;
  ownershipSaved: () => void;
  stopSession: SessionLaunchRuntimePort["stopSession"];
  stage: (stage: string) => void;
  prepare: () => Effect.Effect<void, HostError>;
  skip: (reason: string) => void;
  checkCanceled: () => Effect.Effect<void, HostError>;
  withSession: (work: Effect.Effect<unknown, unknown>) => Effect.Effect<void>;
  send: (submit: SessionLaunchRuntimePort["sendUserMessage"]) => Effect.Effect<void, HostError>;
};

export type SessionLaunchService<
  Request extends SessionLaunchRef,
  State extends SessionLaunchState,
  Ref extends SessionLaunchRef,
  Read,
> = {
  launch: (request: Request) => Effect.Effect<State, HostError>;
  read: (input: Read) => Effect.Effect<State[], HostError>;
  recover: (input: Ref) => Effect.Effect<State, HostError>;
  cancel: (input: Ref) => Effect.Effect<State, HostError>;
  cancelSessionBeforeStop: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>;
  cancelRecoveryBeforeSend: (ref: AgentSessionLiveRef) => Effect.Effect<void, HostError>;
  shutdown: () => Effect.Effect<void>;
};
