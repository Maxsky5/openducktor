import type { FileDiff, FileStatus } from "@openducktor/contracts";
import type {
  AgentEvent,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
  AgentSessionContext,
  AgentSessionTodoItem,
  AgentStreamPart,
} from "../types/agent-orchestrator";

export type StartAgentSessionInput = Omit<AgentSessionContext, "sessionId"> & {
  sessionId?: string;
};

export type ResumeAgentSessionInput = Omit<AgentSessionContext, "sessionId"> & {
  sessionId: string;
  externalSessionId: string;
};

export type SendAgentUserMessageInput = {
  sessionId: string;
  content: string;
  model?: AgentModelSelection;
};

export type LoadAgentSessionHistoryInput = {
  baseUrl: string;
  workingDirectory: string;
  externalSessionId: string;
  limit?: number;
};

export type LoadAgentSessionTodosInput = {
  baseUrl: string;
  workingDirectory: string;
  externalSessionId: string;
};

export type AgentSessionHistoryMessage = {
  messageId: string;
  role: "user" | "assistant";
  timestamp: string;
  text: string;
  totalTokens?: number;
  parts: AgentStreamPart[];
};

export type ReplyPermissionInput = {
  sessionId: string;
  requestId: string;
  reply: "once" | "always" | "reject";
  message?: string;
};

export type ReplyQuestionInput = {
  sessionId: string;
  requestId: string;
  answers: string[][];
};

export type EventUnsubscribe = () => void;

export type AgentSessionSummary = {
  sessionId: string;
  externalSessionId: string;
  role: AgentRole;
  scenario: AgentScenario;
  startedAt: string;
  status: "starting" | "running" | "idle" | "error" | "stopped";
};

export interface AgentEnginePort {
  startSession(input: StartAgentSessionInput): Promise<AgentSessionSummary>;
  resumeSession(input: ResumeAgentSessionInput): Promise<AgentSessionSummary>;
  listAvailableModels(input: {
    baseUrl: string;
    workingDirectory: string;
  }): Promise<AgentModelCatalog>;
  hasSession(sessionId: string): boolean;
  loadSessionHistory(input: LoadAgentSessionHistoryInput): Promise<AgentSessionHistoryMessage[]>;
  loadSessionTodos(input: LoadAgentSessionTodosInput): Promise<AgentSessionTodoItem[]>;
  sendUserMessage(input: SendAgentUserMessageInput): Promise<void>;
  replyPermission(input: ReplyPermissionInput): Promise<void>;
  replyQuestion(input: ReplyQuestionInput): Promise<void>;
  subscribeEvents(sessionId: string, listener: (event: AgentEvent) => void): EventUnsubscribe;
  stopSession(sessionId: string): Promise<void>;
  loadSessionDiff(input: {
    baseUrl: string;
    sessionId: string;
    messageId?: string;
  }): Promise<FileDiff[]>;
  loadFileStatus(input: { baseUrl: string }): Promise<FileStatus[]>;
}
