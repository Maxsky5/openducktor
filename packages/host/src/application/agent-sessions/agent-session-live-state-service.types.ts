import type {
  AcceptedAgentUserMessage,
  AgentSessionContextUsage,
  AgentSessionControlForkInput,
  AgentSessionControlReleaseInput,
  AgentSessionControlResumeInput,
  AgentSessionControlSendInput,
  AgentSessionControlStartInput,
  AgentSessionControlStopInput,
  AgentSessionControlSummary,
  AgentSessionControlUpdateModelInput,
  AgentSessionControlUpdateTitleInput,
  AgentSessionLiveEnvelope,
  AgentSessionLiveListInput,
  AgentSessionLiveLoadContextInput,
  AgentSessionLiveLoadDiffInput,
  AgentSessionLiveReadInput,
  AgentSessionLiveReadResult,
  AgentSessionLiveRef,
  AgentSessionAuthorizedRoot,
  AgentSessionLiveRefreshInput,
  AgentSessionLiveReplyApprovalInput,
  AgentSessionLiveReplyQuestionInput,
  AgentSessionLiveSnapshot,
  FileDiff,
  TaskAgentSessions,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../../effect/host-errors";
import type {
  AgentSessionLiveRegistration,
  AgentSessionLiveAdapterBinding,
  AgentSessionLiveAdapterPort,
  AgentSessionLiveAdapterRegistryPort,
  AgentSessionControlContinueInterruptedTurnInput,
  AgentSessionSendOptions,
  AgentSessionTitleUpdateOutcome,
} from "../../ports/agent-session-live-adapter-port";
import type { AgentSessionPersistencePort } from "../../ports/agent-session-persistence-port";
import type {
  AgentSessionLiveEnvelopePublisher,
  AgentSessionLiveFaultLogger,
} from "./agent-session-live-envelope";
import type { LiveStateCoordinator } from "./live-state-coordinator";
import type { WithProcessStartAdmission } from "../workspaces/workspace-admission-service";
import type { RuntimeAdmissionPort } from "../../ports/runtime-admission-port";

export type AgentSessionLiveStateService = {
  readonly publishTaskSessionRecords: (
    ref: AgentSessionLiveRef,
    records: TaskAgentSessions,
  ) => Effect.Effect<void, HostError>;
  /**
   * Keeps a failed launch in the live session snapshot until the next accepted message. The
   * snapshot update shows it in the session and raises a session error notification. Returns the
   * notice id, or null when the session is not live and nothing can show the failure.
   */
  readonly reportLaunchFailure: (
    ref: AgentSessionLiveRef,
    message: string,
  ) => Effect.Effect<string | null, HostError>;
  readonly holdWorkflowLaunch: (
    ref: AgentSessionLiveRef,
    held: boolean,
  ) => Effect.Effect<void, HostError>;
  readonly refresh: (input: AgentSessionLiveRefreshInput) => Effect.Effect<void, HostError>;
  readonly list: (
    input: AgentSessionLiveListInput,
  ) => Effect.Effect<ReadonlyArray<AgentSessionLiveSnapshot>, HostError>;
  /** Lists sessions affected by runtime lifecycle actions across all repositories. */
  readonly listRuntimeSessions: (
    runtimeKind: string,
  ) => Effect.Effect<ReadonlyArray<AgentSessionLiveSnapshot>, HostError>;
  readonly read: (
    input: AgentSessionLiveReadInput,
  ) => Effect.Effect<AgentSessionLiveReadResult, HostError>;
  readonly loadContext: (
    input: AgentSessionLiveLoadContextInput,
  ) => Effect.Effect<AgentSessionContextUsage | null, HostError>;
  readonly loadSessionDiff: (
    input: AgentSessionLiveLoadDiffInput,
  ) => Effect.Effect<ReadonlyArray<FileDiff>, HostError>;
  readonly replyApproval: (
    input: AgentSessionLiveReplyApprovalInput,
  ) => Effect.Effect<void, HostError>;
  readonly replyQuestion: (
    input: AgentSessionLiveReplyQuestionInput,
  ) => Effect.Effect<void, HostError>;
  readonly startSession: (
    input: AgentSessionControlStartInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError>;
  readonly resumeSession: (
    input: AgentSessionControlResumeInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError>;
  readonly continueInterruptedTurn: (
    input: AgentSessionControlContinueInterruptedTurnInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError>;
  readonly forkSession: (
    input: AgentSessionControlForkInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError>;
  readonly sendUserMessage: (
    input: AgentSessionControlSendInput,
    options?: AgentSessionSendOptions,
  ) => Effect.Effect<AcceptedAgentUserMessage, HostError>;
  readonly updateSessionModel: (
    input: AgentSessionControlUpdateModelInput,
  ) => Effect.Effect<void, HostError>;
  readonly updateSessionTitle: (
    input: AgentSessionControlUpdateTitleInput,
  ) => Effect.Effect<AgentSessionTitleUpdateOutcome, HostError>;
  readonly stopSession: (input: AgentSessionControlStopInput) => Effect.Effect<void, HostError>;
  readonly releaseSession: (
    input: AgentSessionControlReleaseInput,
  ) => Effect.Effect<void, HostError>;
  readonly registerRuntimeAdapter: (
    adapter: AgentSessionLiveAdapterPort,
  ) => Effect.Effect<void, HostError>;
  readonly releaseRuntime: (
    runtimeId: string,
  ) => Effect.Effect<ReadonlyArray<AgentSessionLiveRef>, HostError>;
  readonly createRuntimeRegistration: (
    binding: AgentSessionLiveAdapterBinding,
  ) => AgentSessionLiveRegistration;
};

export type CreateAgentSessionLiveStateServiceInput = {
  readonly readSessionRootRefs?: (
    repoPath: string,
  ) => Effect.Effect<AgentSessionAuthorizedRoot[], HostError>;
  readonly persistence?: AgentSessionPersistencePort;
  readonly adapterRegistry: AgentSessionLiveAdapterRegistryPort;
  readonly runtimeAdmission: RuntimeAdmissionPort;
  readonly withProcessStartAdmission?: WithProcessStartAdmission | undefined;
  readonly faultLog: AgentSessionLiveFaultLogger;
  readonly publish: AgentSessionLiveEnvelopePublisher;
  readonly observeNotificationInput?: (
    envelope: AgentSessionLiveEnvelope,
    provenance: "baseline" | "live",
  ) => void;
  readonly coordinator?: LiveStateCoordinator;
};
