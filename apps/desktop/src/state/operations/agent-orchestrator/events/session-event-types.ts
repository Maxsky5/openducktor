import type { AgentEnginePort } from "@openducktor/core";
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
  refreshTaskData: (repoPath: string, taskId?: string) => Promise<void>;
};

export type SessionStoreContext = Pick<
  AttachAgentSessionListenerParams,
  "sessionId" | "sessionsRef" | "updateSession"
>;

export type SessionDraftContext = Pick<
  AttachAgentSessionListenerParams,
  | "sessionId"
  | "draftRawBySessionRef"
  | "draftSourceBySessionRef"
  | "draftMessageIdBySessionRef"
  | "draftFlushTimeoutBySessionRef"
>;

export type SessionTurnContext = Pick<
  AttachAgentSessionListenerParams,
  | "sessionId"
  | "turnStartedAtBySessionRef"
  | "turnModelBySessionRef"
  | "resolveTurnDurationMs"
  | "clearTurnDuration"
>;

export type SessionPermissionContext = Pick<AttachAgentSessionListenerParams, "adapter">;

export type SessionRefreshContext = Pick<
  AttachAgentSessionListenerParams,
  "repoPath" | "refreshTaskData"
>;

export type SessionLifecycleEventContext = {
  store: SessionStoreContext;
  drafts: SessionDraftContext;
  turn: SessionTurnContext;
  permissions: SessionPermissionContext;
};

export type SessionPartEventContext = {
  store: SessionStoreContext;
  drafts: SessionDraftContext;
  turn: SessionTurnContext;
  refresh: SessionRefreshContext;
};

export type SessionToolPartEventContext = Pick<SessionPartEventContext, "store" | "refresh">;

export type SessionEventHandlerContext = {
  lifecycle: SessionLifecycleEventContext;
  parts: SessionPartEventContext;
};

export const createSessionEventHandlerContext = (
  context: AttachAgentSessionListenerParams,
): SessionEventHandlerContext => ({
  lifecycle: {
    store: {
      sessionId: context.sessionId,
      sessionsRef: context.sessionsRef,
      updateSession: context.updateSession,
    },
    drafts: {
      sessionId: context.sessionId,
      draftRawBySessionRef: context.draftRawBySessionRef,
      draftSourceBySessionRef: context.draftSourceBySessionRef,
      ...(context.draftMessageIdBySessionRef
        ? { draftMessageIdBySessionRef: context.draftMessageIdBySessionRef }
        : {}),
      ...(context.draftFlushTimeoutBySessionRef
        ? { draftFlushTimeoutBySessionRef: context.draftFlushTimeoutBySessionRef }
        : {}),
    },
    turn: {
      sessionId: context.sessionId,
      turnStartedAtBySessionRef: context.turnStartedAtBySessionRef,
      ...(context.turnModelBySessionRef
        ? { turnModelBySessionRef: context.turnModelBySessionRef }
        : {}),
      resolveTurnDurationMs: context.resolveTurnDurationMs,
      clearTurnDuration: context.clearTurnDuration,
    },
    permissions: {
      adapter: context.adapter,
    },
  },
  parts: {
    store: {
      sessionId: context.sessionId,
      sessionsRef: context.sessionsRef,
      updateSession: context.updateSession,
    },
    drafts: {
      sessionId: context.sessionId,
      draftRawBySessionRef: context.draftRawBySessionRef,
      draftSourceBySessionRef: context.draftSourceBySessionRef,
      ...(context.draftMessageIdBySessionRef
        ? { draftMessageIdBySessionRef: context.draftMessageIdBySessionRef }
        : {}),
      ...(context.draftFlushTimeoutBySessionRef
        ? { draftFlushTimeoutBySessionRef: context.draftFlushTimeoutBySessionRef }
        : {}),
    },
    turn: {
      sessionId: context.sessionId,
      turnStartedAtBySessionRef: context.turnStartedAtBySessionRef,
      ...(context.turnModelBySessionRef
        ? { turnModelBySessionRef: context.turnModelBySessionRef }
        : {}),
      resolveTurnDurationMs: context.resolveTurnDurationMs,
      clearTurnDuration: context.clearTurnDuration,
    },
    refresh: {
      repoPath: context.repoPath,
      refreshTaskData: context.refreshTaskData,
    },
  },
});
