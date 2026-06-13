import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, AgentEvent, AgentSessionRef } from "@openducktor/core";
import type { MutableRefObject } from "react";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { SessionRuntimeDataWriter } from "../support/session-runtime-data-writer";

export type DraftChannel = "reasoning";
export type DraftSource = "delta" | "part";
export type DraftChannelValueMap<T> = Partial<Record<DraftChannel, T>>;

export type UpdateSession = (
  externalSessionId: string,
  updater: (current: AgentSessionState) => AgentSessionState,
  options?: { persist?: boolean },
) => void;

export type ResolveTurnDuration = (
  externalSessionId: string,
  timestamp: string,
  messages?: AgentSessionState["messages"],
) => number | undefined;

export type RecordTurnTimestamp = (externalSessionId: string, timestamp: string | number) => void;

export type SessionEventAdapter = Pick<AgentEnginePort, "subscribeEvents" | "replyApproval">;

export type SessionEvent = AgentEvent;
export type SessionPartEvent = Extract<SessionEvent, { type: "assistant_part" }>;
export type SessionPart = SessionPartEvent["part"];

export type ListenToAgentSessionParams = {
  adapter: SessionEventAdapter;
  repoPath: string;
  externalSessionId: string;
  sessionRef: AgentSessionRef;
  eventBatchWindowMs?: number;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  draftRawBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<string>>>;
  draftSourceBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<DraftSource>>>;
  draftMessageIdBySessionRef?: MutableRefObject<Record<string, DraftChannelValueMap<string>>>;
  draftFlushTimeoutBySessionRef?: MutableRefObject<
    Record<string, ReturnType<typeof setTimeout> | undefined>
  >;
  turnStartedAtBySessionRef: MutableRefObject<Record<string, number>>;
  turnModelBySessionRef?: MutableRefObject<Record<string, AgentSessionState["selectedModel"]>>;
  contextUsageMessageIdBySessionRef?: MutableRefObject<Record<string, string>>;
  updateSession: UpdateSession;
  runtimeDataWriter: SessionRuntimeDataWriter;
  isSessionListenerActive?: (externalSessionId: string) => boolean;
  recordTurnActivityTimestamp?: RecordTurnTimestamp;
  recordTurnUserMessageTimestamp?: RecordTurnTimestamp;
  resolveTurnDurationMs: ResolveTurnDuration;
  clearTurnDuration: (externalSessionId: string, completedTimestamp?: string) => void;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: { forceFreshTaskList?: boolean },
  ) => Promise<void>;
  resolveRuntimeDefinition?: (runtimeKind: RuntimeKind) => RuntimeDescriptor | null;
};

export type SessionStoreContext = Pick<
  ListenToAgentSessionParams,
  "externalSessionId" | "sessionsRef" | "updateSession" | "isSessionListenerActive"
>;

export type SessionRuntimeDataContext = Pick<
  ListenToAgentSessionParams,
  "repoPath" | "runtimeDataWriter"
>;

export type SessionDraftContext = Pick<
  ListenToAgentSessionParams,
  | "externalSessionId"
  | "draftRawBySessionRef"
  | "draftSourceBySessionRef"
  | "draftMessageIdBySessionRef"
  | "draftFlushTimeoutBySessionRef"
>;

export type SessionTurnContext = Pick<
  ListenToAgentSessionParams,
  | "externalSessionId"
  | "turnStartedAtBySessionRef"
  | "turnModelBySessionRef"
  | "contextUsageMessageIdBySessionRef"
  | "recordTurnActivityTimestamp"
  | "recordTurnUserMessageTimestamp"
  | "resolveTurnDurationMs"
  | "clearTurnDuration"
>;

export type SessionApprovalContext = Pick<
  ListenToAgentSessionParams,
  "adapter" | "resolveRuntimeDefinition"
>;

export type SessionRefreshContext = Pick<
  ListenToAgentSessionParams,
  "repoPath" | "refreshTaskData" | "resolveRuntimeDefinition"
>;

export type SessionLifecycleEventContext = {
  store: SessionStoreContext;
  drafts: SessionDraftContext;
  turn: SessionTurnContext;
  approvals: SessionApprovalContext;
  runtimeData: SessionRuntimeDataContext;
};

export type SessionPartEventContext = {
  store: SessionStoreContext;
  drafts: SessionDraftContext;
  turn: SessionTurnContext;
  refresh: SessionRefreshContext;
  runtimeData: SessionRuntimeDataContext;
};

export type SessionToolPartEventContext = Pick<
  SessionPartEventContext,
  "store" | "refresh" | "runtimeData"
>;

export type SessionEventHandlerContext = {
  lifecycle: SessionLifecycleEventContext;
  parts: SessionPartEventContext;
};

export const createSessionEventHandlerContext = (
  context: ListenToAgentSessionParams,
): SessionEventHandlerContext => ({
  lifecycle: {
    store: {
      externalSessionId: context.externalSessionId,
      sessionsRef: context.sessionsRef,
      updateSession: context.updateSession,
      ...(context.isSessionListenerActive
        ? { isSessionListenerActive: context.isSessionListenerActive }
        : {}),
    },
    drafts: {
      externalSessionId: context.externalSessionId,
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
      externalSessionId: context.externalSessionId,
      turnStartedAtBySessionRef: context.turnStartedAtBySessionRef,
      ...(context.turnModelBySessionRef
        ? { turnModelBySessionRef: context.turnModelBySessionRef }
        : {}),
      ...(context.contextUsageMessageIdBySessionRef
        ? { contextUsageMessageIdBySessionRef: context.contextUsageMessageIdBySessionRef }
        : {}),
      ...(context.recordTurnActivityTimestamp
        ? { recordTurnActivityTimestamp: context.recordTurnActivityTimestamp }
        : {}),
      ...(context.recordTurnUserMessageTimestamp
        ? { recordTurnUserMessageTimestamp: context.recordTurnUserMessageTimestamp }
        : {}),
      resolveTurnDurationMs: context.resolveTurnDurationMs,
      clearTurnDuration: context.clearTurnDuration,
    },
    approvals: {
      adapter: context.adapter,
      ...(context.resolveRuntimeDefinition
        ? { resolveRuntimeDefinition: context.resolveRuntimeDefinition }
        : {}),
    },
    runtimeData: {
      repoPath: context.repoPath,
      runtimeDataWriter: context.runtimeDataWriter,
    },
  },
  parts: {
    store: {
      externalSessionId: context.externalSessionId,
      sessionsRef: context.sessionsRef,
      updateSession: context.updateSession,
    },
    drafts: {
      externalSessionId: context.externalSessionId,
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
      externalSessionId: context.externalSessionId,
      turnStartedAtBySessionRef: context.turnStartedAtBySessionRef,
      ...(context.turnModelBySessionRef
        ? { turnModelBySessionRef: context.turnModelBySessionRef }
        : {}),
      ...(context.contextUsageMessageIdBySessionRef
        ? { contextUsageMessageIdBySessionRef: context.contextUsageMessageIdBySessionRef }
        : {}),
      ...(context.recordTurnActivityTimestamp
        ? { recordTurnActivityTimestamp: context.recordTurnActivityTimestamp }
        : {}),
      ...(context.recordTurnUserMessageTimestamp
        ? { recordTurnUserMessageTimestamp: context.recordTurnUserMessageTimestamp }
        : {}),
      resolveTurnDurationMs: context.resolveTurnDurationMs,
      clearTurnDuration: context.clearTurnDuration,
    },
    refresh: {
      repoPath: context.repoPath,
      refreshTaskData: context.refreshTaskData,
      ...(context.resolveRuntimeDefinition
        ? { resolveRuntimeDefinition: context.resolveRuntimeDefinition }
        : {}),
    },
    runtimeData: {
      repoPath: context.repoPath,
      runtimeDataWriter: context.runtimeDataWriter,
    },
  },
});
