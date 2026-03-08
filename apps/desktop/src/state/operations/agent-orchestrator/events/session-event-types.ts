import type { AgentEnginePort, AgentRuntimeConnection } from "@openducktor/core";
import type { MutableRefObject } from "react";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";

export type UpdateSession = (
  sessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

export type ResolveTurnDuration = (
  sessionId: string,
  timestamp: string,
  messages?: AgentChatMessage[],
) => number | undefined;

export type SessionEventAdapter = Pick<AgentEnginePort, "subscribeEvents" | "replyPermission">;

export type SessionEvent = Parameters<Parameters<SessionEventAdapter["subscribeEvents"]>[1]>[0];
export type SessionPartEvent = Extract<SessionEvent, { type: "assistant_part" }>;
export type SessionPart = SessionPartEvent["part"];

export type AttachAgentSessionListenerParams = {
  adapter: SessionEventAdapter;
  repoPath: string;
  sessionId: string;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  draftRawBySessionRef: MutableRefObject<Record<string, string>>;
  draftSourceBySessionRef: MutableRefObject<Record<string, "delta" | "part">>;
  turnStartedAtBySessionRef: MutableRefObject<Record<string, number>>;
  updateSession: UpdateSession;
  resolveTurnDurationMs: ResolveTurnDuration;
  clearTurnDuration: (sessionId: string) => void;
  refreshTaskData: (repoPath: string) => Promise<void>;
  loadSessionTodos: (
    sessionId: string,
    runtimeKind: string,
    runtimeConnection: AgentRuntimeConnection,
    externalSessionId: string,
  ) => Promise<void>;
};

export type SessionEventContext = AttachAgentSessionListenerParams;
