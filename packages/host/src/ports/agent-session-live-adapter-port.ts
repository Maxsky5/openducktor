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
  AgentSessionLiveLoadContextInput,
  AgentSessionLiveReadResult,
  AgentSessionLiveRef,
  AgentSessionLiveReplyApprovalInput,
  AgentSessionLiveReplyQuestionInput,
  AgentSessionLiveSnapshot,
  AgentSessionTranscriptEvent,
  RuntimeKind,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";

export type AgentSessionCatalogInvalidation = {
  readonly repoPath: string;
  readonly runtimeKind: RuntimeKind;
  readonly workingDirectory?: string;
};

export type AgentSessionLiveAdapterChange =
  | {
      readonly type: "session_upsert";
      readonly snapshot: AgentSessionLiveSnapshot;
    }
  | {
      readonly type: "session_removed";
      readonly ref: AgentSessionLiveRef;
    }
  | {
      readonly type: "transcript_event";
      readonly event: AgentSessionTranscriptEvent;
    }
  | ({ readonly type: "catalog_invalidated" } & AgentSessionCatalogInvalidation)
  | {
      readonly type: "fault";
      readonly repoPath: string;
      readonly message: string;
      readonly operation?: string;
      readonly ref?: AgentSessionLiveRef;
    };

export type AgentSessionLiveAdapterMutation<Success> = {
  readonly value: Success;
  readonly changes: ReadonlyArray<AgentSessionLiveAdapterChange>;
};

/** Private runtime registration identity. It never crosses the host boundary. */
export type AgentSessionLiveAdapterBinding = {
  readonly runtimeId: string;
  readonly runtimeKind: RuntimeKind;
  readonly repoPath: string;
};

export type AgentSessionLiveAdapterScope = Pick<AgentSessionLiveRef, "repoPath" | "runtimeKind">;

export type AgentSessionLiveAdapterPort = {
  readonly binding: AgentSessionLiveAdapterBinding;
  readonly matches: (ref: AgentSessionLiveRef) => boolean;
  readonly listRetainedSnapshots: (
    repoPath: string,
  ) => Effect.Effect<ReadonlyArray<AgentSessionLiveSnapshot>, HostError>;
  readonly readRetainedSnapshot: (
    ref: AgentSessionLiveRef,
  ) => Effect.Effect<AgentSessionLiveReadResult, HostError>;
  readonly loadContext: (
    input: AgentSessionLiveLoadContextInput,
  ) => Effect.Effect<AgentSessionContextUsage | null, HostError>;
  readonly replyApproval: (
    input: AgentSessionLiveReplyApprovalInput,
  ) => Effect.Effect<void, HostError>;
  readonly replyQuestion: (
    input: AgentSessionLiveReplyQuestionInput,
  ) => Effect.Effect<void, HostError>;
  /** Clears only this runtime and returns the public sessions that disappeared. */
  readonly releaseRuntime: () => Effect.Effect<ReadonlyArray<AgentSessionLiveRef>, HostError>;
};

export type AgentSessionControlAdapterPort = {
  readonly startSession: (
    input: AgentSessionControlStartInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError>;
  readonly resumeSession: (
    input: AgentSessionControlResumeInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError>;
  readonly forkSession: (
    input: AgentSessionControlForkInput,
  ) => Effect.Effect<AgentSessionControlSummary, HostError>;
  readonly sendUserMessage: (
    input: AgentSessionControlSendInput,
  ) => Effect.Effect<AcceptedAgentUserMessage, HostError>;
  readonly updateSessionModel: (
    input: AgentSessionControlUpdateModelInput,
  ) => Effect.Effect<void, HostError>;
  readonly stopSession: (input: AgentSessionControlStopInput) => Effect.Effect<void, HostError>;
  readonly releaseSession: (
    input: AgentSessionControlReleaseInput,
  ) => Effect.Effect<void, HostError>;
};

export type AgentSessionRuntimeAdapterPort = AgentSessionLiveAdapterPort &
  AgentSessionControlAdapterPort;

export type AgentSessionLiveAdapterRegistryPort = {
  readonly register: (adapter: AgentSessionLiveAdapterPort) => Effect.Effect<void, HostError>;
  readonly remove: (runtimeId: string) => Effect.Effect<AgentSessionLiveAdapterPort | null>;
  readonly listForRepo: (repoPath: string) => ReadonlyArray<AgentSessionLiveAdapterPort>;
  readonly resolveForScope: (
    scope: AgentSessionLiveAdapterScope,
  ) => Effect.Effect<AgentSessionLiveAdapterPort, HostError>;
  readonly resolveControlForScope: (
    scope: AgentSessionLiveAdapterScope,
  ) => Effect.Effect<AgentSessionRuntimeAdapterPort, HostError>;
  readonly resolveControl: (
    ref: AgentSessionLiveRef,
  ) => Effect.Effect<AgentSessionRuntimeAdapterPort, HostError>;
  readonly find: (
    ref: AgentSessionLiveRef,
  ) => Effect.Effect<AgentSessionLiveAdapterPort | null, HostError>;
  readonly resolve: (
    ref: AgentSessionLiveRef,
  ) => Effect.Effect<AgentSessionLiveAdapterPort, HostError>;
};
