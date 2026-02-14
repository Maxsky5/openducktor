import type { RunEvent } from "@openblueprint/contracts";

export type SessionMode = "planner" | "builder";

export type StartSessionInput = {
  sessionId: string;
  repoPath: string;
  taskId: string;
  mode: SessionMode;
  baseUrl?: string;
};

export type SendMessageInput = {
  sessionId: string;
  content: string;
};

export type EventUnsubscribe = () => void;

export interface AgentEnginePort {
  startPlanSession(input: Omit<StartSessionInput, "mode">): Promise<void>;
  startBuildSession(input: Omit<StartSessionInput, "mode">): Promise<void>;
  sendUserMessage(input: SendMessageInput): Promise<void>;
  subscribeEvents(sessionId: string, listener: (event: RunEvent) => void): EventUnsubscribe;
  stopSession(sessionId: string): Promise<void>;
}
