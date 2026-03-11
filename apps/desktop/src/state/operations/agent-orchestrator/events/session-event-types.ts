import type { AgentEnginePort, AgentRuntimeConnection } from "@openducktor/core";
import type { MutableRefObject } from "react";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";

export type DraftChannel = "text" | "reasoning";
export type DraftSource = "delta" | "part";
export type DraftChannelValueMap<T> = Partial<Record<DraftChannel, T>>;

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
  draftRawBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<string>>>;
  draftSourceBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<DraftSource>>>;
  draftMessageIdBySessionRef?: MutableRefObject<Record<string, DraftChannelValueMap<string>>>;
  draftFlushTimeoutBySessionRef?: MutableRefObject<
    Record<string, ReturnType<typeof setTimeout> | undefined>
  >;
  turnStartedAtBySessionRef: MutableRefObject<Record<string, number>>;
  turnModelBySessionRef?: MutableRefObject<Record<string, AgentSessionState["selectedModel"]>>;
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
