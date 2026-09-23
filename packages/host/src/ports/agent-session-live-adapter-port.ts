import type { AgentGeneratedImageReadInput } from "@openducktor/contracts";
import type { AgentGeneratedImageSource } from "@openducktor/core";
import type {
  AgentGeneratedImageBatch,
  AgentGeneratedImageBatchResult,
  AgentGeneratedImageBatchInput,
  AgentGeneratedImageDescribeInput,
  AgentGeneratedImageDescribeResult,
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
  AgentSessionLiveLoadContextInput,
  AgentSessionLiveLoadDiffInput,
  AgentSessionLiveReadResult,
  AgentSessionLiveRef,
  AgentSessionLiveReplyApprovalInput,
  AgentSessionLiveReplyQuestionInput,
  AgentSessionLiveSnapshot,
  AgentSessionTranscriptEvent,
  FileDiff,
  RuntimeKind,
  SlashCommandCatalog,
} from "@openducktor/contracts";
import type { Effect } from "effect";
import type { HostError } from "../effect/host-errors";
import type { AgentRuntimeQueryAdapterPort } from "./agent-runtime-query-port";

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
      readonly type: "slash_command_catalog_updated";
      readonly repoPath: string;
      readonly runtimeKind: RuntimeKind;
      readonly workingDirectory: string;
      readonly catalog: SlashCommandCatalog;
    }
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

/** Routing metadata. It never crosses the host boundary. */
export type AgentSessionLiveAdapterBinding = {
  readonly runtimeId: string;
  readonly runtimeKind: RuntimeKind;
  readonly repoPath: string;
};

type RunLiveMutation = <A>(
  mutation: Effect.Effect<AgentSessionLiveAdapterMutation<A>, HostError>,
) => Effect.Effect<A, HostError>;

/** A nominal lease. Its bound mutation method retains identity when a caller copies it. */
export class AgentSessionLiveRegistration implements AgentSessionLiveAdapterBinding {
  readonly runtimeId: string;
  readonly runtimeKind: RuntimeKind;
  readonly repoPath: string;
  readonly #run: RunLiveMutation;

  constructor(binding: AgentSessionLiveAdapterBinding, run: RunLiveMutation) {
    this.runtimeId = binding.runtimeId;
    this.runtimeKind = binding.runtimeKind;
    this.repoPath = binding.repoPath;
    this.#run = run;
  }

  readonly runMutation: RunLiveMutation = (mutation) => this.#run(mutation);
}

export type AgentSessionLiveAdapterScope = Pick<AgentSessionLiveRef, "repoPath" | "runtimeKind">;

type AgentSessionLiveAdapterBase = {
  readonly sessionImport: import("./runtime-session-import-port").RuntimeSessionImportPort;
  readonly queries: AgentRuntimeQueryAdapterPort;
  readonly beginGeneratedImageBatch: (
    input: AgentGeneratedImageBatchInput,
  ) => Effect.Effect<AgentGeneratedImageBatchResult, HostError>;
  readonly releaseGeneratedImageBatch: (
    input: AgentGeneratedImageBatch,
  ) => Effect.Effect<void, HostError>;
  readonly describeGeneratedImages: (
    input: AgentGeneratedImageDescribeInput,
  ) => Effect.Effect<AgentGeneratedImageDescribeResult, HostError>;
  readonly resolveGeneratedImageSource: (
    input: AgentGeneratedImageReadInput,
  ) => Effect.Effect<AgentGeneratedImageSource, HostError>;
  readonly binding: AgentSessionLiveRegistration;
  readonly refreshSnapshots?: (
    repoPath: string,
    roots?: AgentSessionLiveRef[],
  ) => Effect.Effect<void, HostError>;
  readonly listSnapshots: (
    repoPath: string,
  ) => Effect.Effect<ReadonlyArray<AgentSessionLiveSnapshot>, HostError>;
  readonly readSnapshot: (
    ref: AgentSessionLiveRef,
  ) => Effect.Effect<AgentSessionLiveReadResult, HostError>;
  readonly loadContext: (
    input: AgentSessionLiveLoadContextInput,
  ) => Effect.Effect<AgentSessionContextUsage | null, HostError>;
  readonly loadSessionDiff?: (
    input: AgentSessionLiveLoadDiffInput,
  ) => Effect.Effect<ReadonlyArray<FileDiff>, HostError>;
  readonly replyApproval: (
    input: AgentSessionLiveReplyApprovalInput,
  ) => Effect.Effect<void, HostError>;
  readonly replyQuestion: (
    input: AgentSessionLiveReplyQuestionInput,
  ) => Effect.Effect<void, HostError>;
  /** Returns terminal transcript updates under the lifecycle lock, without re-entering it. */
  readonly settleRuntimeTranscript?: () => Effect.Effect<
    ReadonlyArray<AgentSessionTranscriptEvent>,
    HostError
  >;
  /** Clears only this runtime and returns the public sessions that disappeared. */
  readonly releaseRuntime: () => Effect.Effect<ReadonlyArray<AgentSessionLiveRef>, HostError>;
};

export type AgentSessionControlContinueInterruptedTurnInput = Omit<
  AgentSessionControlResumeInput,
  "resumeMode"
>;

/** `renamed` commits the new summary. `not_attached` means the runtime holds no session with that id. */
export type AgentSessionTitleUpdateOutcome =
  | { readonly status: "renamed" }
  | { readonly status: "not_attached" };

export type AgentSessionControlAdapterPort = {
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
};

export type AgentSessionRuntimeAdapterPort = AgentSessionLiveAdapterBase &
  AgentSessionControlAdapterPort & {
    readonly supportsSessionControl: true;
  };

export type AgentSessionLiveAdapterPort =
  | (AgentSessionLiveAdapterBase & { readonly supportsSessionControl: false })
  | AgentSessionRuntimeAdapterPort;

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
};
