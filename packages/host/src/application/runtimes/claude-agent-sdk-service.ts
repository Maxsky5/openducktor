import type { AgentSessionContextUsage, FileDiff, FileStatus } from "@openducktor/contracts";
import type {
  AcceptedAgentUserMessage,
  AgentFileSearchResult,
  AgentModelCatalog,
  AgentSessionHistoryMessage,
  AgentSessionSummary,
  AgentSessionTodoItem,
  AgentSkillCatalog,
  AgentSlashCommandCatalog,
  AgentSubagentCatalog,
  ForkAgentSessionInput,
  ListAgentModelsInput,
  ListAgentSkillsInput,
  ListAgentSlashCommandsInput,
  ListAgentSubagentsInput,
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
import type { HostOperationError, HostValidationError } from "../../effect/host-errors";

export type ClaudeAgentSdkServiceError = HostOperationError | HostValidationError;

export type ClaudeAgentSdkService = {
  startSession(
    input: StartAgentSessionInput,
  ): Effect.Effect<AgentSessionSummary, ClaudeAgentSdkServiceError>;
  resumeSession(
    input: ResumeAgentSessionInput,
  ): Effect.Effect<AgentSessionSummary, ClaudeAgentSdkServiceError>;
  forkSession(
    input: ForkAgentSessionInput,
  ): Effect.Effect<AgentSessionSummary, ClaudeAgentSdkServiceError>;
  releaseSession(input: SessionRef): Effect.Effect<void, ClaudeAgentSdkServiceError>;
  listAvailableModels(
    input: ListAgentModelsInput,
  ): Effect.Effect<AgentModelCatalog, ClaudeAgentSdkServiceError>;
  listAvailableSlashCommands(
    input: ListAgentSlashCommandsInput,
  ): Effect.Effect<AgentSlashCommandCatalog, ClaudeAgentSdkServiceError>;
  listAvailableSkills(
    input: ListAgentSkillsInput,
  ): Effect.Effect<AgentSkillCatalog, ClaudeAgentSdkServiceError>;
  listAvailableSubagents(
    input: ListAgentSubagentsInput,
  ): Effect.Effect<AgentSubagentCatalog, ClaudeAgentSdkServiceError>;
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
  ): Effect.Effect<AcceptedAgentUserMessage, ClaudeAgentSdkServiceError>;
  replyApproval(input: ReplyApprovalInput): Effect.Effect<void, ClaudeAgentSdkServiceError>;
  replyQuestion(input: ReplyQuestionInput): Effect.Effect<void, ClaudeAgentSdkServiceError>;
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
  stopSessionsForRuntime(runtimeId: string): Effect.Effect<void, HostOperationError>;
};
