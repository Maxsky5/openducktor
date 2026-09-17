import type { AgentSessionContextUsage, FileDiff, FileStatus } from "@openducktor/contracts";
import type {
  AcceptedAgentUserMessage,
  AgentEvent,
  AgentFileSearchResult,
  AgentRuntimeCatalogRead,
  AgentSessionHistoryMessage,
  AgentSessionSummary,
  AgentSessionTodoItem,
  ContinueInterruptedAgentTurnInput,
  ForkAgentSessionInput,
  ListAgentRuntimeCatalogInput,
  LoadAgentFileStatusInput,
  LoadAgentSessionDiffInput,
  LoadAgentSessionHistoryInput,
  LoadAgentSessionTodosInput,
  ReplyApprovalInput,
  ReplyQuestionInput,
  ResumeAgentSessionInput,
  SearchAgentFilesInput,
  SendAgentUserMessageInput,
  SessionRef,
  StartAgentSessionInput,
  UpdateAgentSessionModelInput,
} from "@openducktor/core";
import type { Effect } from "effect";
import type {
  HostOperationErrorAggregate,
  HostValidationErrorAggregate,
} from "../../effect/host-errors";

export type ClaudeAgentSdkServiceError = HostOperationErrorAggregate | HostValidationErrorAggregate;

export type ClaudePendingInputResolution = {
  readonly event: Extract<AgentEvent, { type: "approval_resolved" | "question_resolved" }>;
  readonly complete: () => void;
};

export type ClaudeAgentSdkService = {
  resolveSessionParent(input: SessionRef): Effect.Effect<string | null, ClaudeAgentSdkServiceError>;
  startSession(
    input: StartAgentSessionInput,
    runtimeId: string,
  ): Effect.Effect<AgentSessionSummary, ClaudeAgentSdkServiceError>;
  resumeSession(
    input: ResumeAgentSessionInput,
    runtimeId: string,
  ): Effect.Effect<AgentSessionSummary, ClaudeAgentSdkServiceError>;
  /** Reports native admission before the remaining continuation startup work settles. */
  continueInterruptedTurn(
    input: ContinueInterruptedAgentTurnInput,
    runtimeId: string,
    onContinuationAdmission?: () => void,
  ): Effect.Effect<AgentSessionSummary, ClaudeAgentSdkServiceError>;
  forkSession(
    input: ForkAgentSessionInput,
    runtimeId: string,
  ): Effect.Effect<AgentSessionSummary, ClaudeAgentSdkServiceError>;
  releaseSession(input: SessionRef): Effect.Effect<void, ClaudeAgentSdkServiceError>;
  loadRuntimeCatalog(
    input: ListAgentRuntimeCatalogInput,
  ): Effect.Effect<AgentRuntimeCatalogRead, ClaudeAgentSdkServiceError>;
  searchFiles(
    input: SearchAgentFilesInput,
  ): Effect.Effect<AgentFileSearchResult[], ClaudeAgentSdkServiceError>;
  loadSessionHistory(
    input: LoadAgentSessionHistoryInput,
  ): Effect.Effect<AgentSessionHistoryMessage[], ClaudeAgentSdkServiceError>;
  loadSessionTodos(
    input: LoadAgentSessionTodosInput,
  ): Effect.Effect<AgentSessionTodoItem[], ClaudeAgentSdkServiceError>;
  loadSessionContextUsage(
    input: LoadAgentSessionHistoryInput,
  ): Effect.Effect<AgentSessionContextUsage | null, ClaudeAgentSdkServiceError>;
  updateSessionModel(
    input: UpdateAgentSessionModelInput,
  ): Effect.Effect<void, ClaudeAgentSdkServiceError>;
  sendUserMessage(
    input: SendAgentUserMessageInput,
    runtimeId: string,
  ): Effect.Effect<AcceptedAgentUserMessage, ClaudeAgentSdkServiceError>;
  prepareApprovalReply(
    input: ReplyApprovalInput,
  ): Effect.Effect<ClaudePendingInputResolution, ClaudeAgentSdkServiceError>;
  prepareQuestionReply(
    input: ReplyQuestionInput,
  ): Effect.Effect<ClaudePendingInputResolution, ClaudeAgentSdkServiceError>;
  stopSession(input: SessionRef): Effect.Effect<void, ClaudeAgentSdkServiceError>;
  probeSessionStatus(input: SessionRef): Effect.Effect<
    {
      supported: boolean;
      hasLiveSession: boolean;
    },
    never
  >;
  loadSessionDiff(
    input: LoadAgentSessionDiffInput,
  ): Effect.Effect<FileDiff[], ClaudeAgentSdkServiceError>;
  loadFileStatus(
    input: LoadAgentFileStatusInput,
  ): Effect.Effect<FileStatus[], ClaudeAgentSdkServiceError>;
  stopSessionsForRuntime(runtimeId: string): Effect.Effect<void, HostOperationErrorAggregate>;
  dispose(): void;
};
