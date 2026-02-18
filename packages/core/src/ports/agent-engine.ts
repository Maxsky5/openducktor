import type {
  AgentEvent,
  AgentModelCatalog,
  AgentModelSelection,
  AgentRole,
  AgentScenario,
  AgentSessionContext,
} from "../types/agent-orchestrator";

export type StartAgentSessionInput = Omit<AgentSessionContext, "sessionId"> & {
  sessionId?: string;
};

export type SendAgentUserMessageInput = {
  sessionId: string;
  content: string;
  model?: AgentModelSelection;
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
  listAvailableModels(input: {
    baseUrl: string;
    workingDirectory: string;
  }): Promise<AgentModelCatalog>;
  sendUserMessage(input: SendAgentUserMessageInput): Promise<void>;
  replyPermission(input: ReplyPermissionInput): Promise<void>;
  replyQuestion(input: ReplyQuestionInput): Promise<void>;
  subscribeEvents(sessionId: string, listener: (event: AgentEvent) => void): EventUnsubscribe;
  stopSession(sessionId: string): Promise<void>;
}
