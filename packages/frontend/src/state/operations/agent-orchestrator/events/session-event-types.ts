import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentEnginePort, AgentEvent, AgentRole, AgentSessionRef } from "@openducktor/core";
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
export type BuildReadOnlyApprovalRejectionMessage = (role: AgentRole) => Promise<string>;

export type SessionEventAdapter = Pick<AgentEnginePort, "subscribeEvents" | "replyApproval">;

export type SessionEvent = AgentEvent;
export type SessionPartEvent = Extract<SessionEvent, { type: "assistant_part" }>;
export type SessionPart = SessionPartEvent["part"];

export type ListenToAgentSessionParams = {
  adapter: SessionEventAdapter;
  sessionRef: AgentSessionRef;
  eventBatchWindowMs?: number;
  sessionsRef: MutableRefObject<Record<string, AgentSessionState>>;
  draftRawBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<string>>>;
  draftSourceBySessionRef: MutableRefObject<Record<string, DraftChannelValueMap<DraftSource>>>;
  draftMessageIdBySessionRef?: MutableRefObject<Record<string, DraftChannelValueMap<string>>>;
  draftFlushTimeoutBySessionRef?: MutableRefObject<
    Record<string, ReturnType<typeof setTimeout> | undefined>
  >;
  turnModelBySessionRef?: MutableRefObject<Record<string, AgentSessionState["selectedModel"]>>;
  contextUsageMessageIdBySessionRef?: MutableRefObject<Record<string, string>>;
  updateSession: UpdateSession;
  runtimeDataWriter: SessionRuntimeDataWriter;
  isSessionListenerActive?: (externalSessionId: string) => boolean;
  recordTurnActivityTimestamp: RecordTurnTimestamp;
  recordTurnUserMessageTimestamp: RecordTurnTimestamp;
  resolveTurnDurationMs: ResolveTurnDuration;
  clearTurnDuration: (externalSessionId: string, completedTimestamp?: string) => void;
  buildReadOnlyApprovalRejectionMessage: BuildReadOnlyApprovalRejectionMessage;
  refreshTaskData: (
    repoPath: string,
    taskIdOrIds?: string | string[],
    options?: { forceFreshTaskList?: boolean },
  ) => Promise<void>;
  resolveRuntimeDefinition?: (runtimeKind: RuntimeKind) => RuntimeDescriptor | null;
};

type SessionEventTargetContext = {
  externalSessionId: string;
};

export type SessionStoreContext = SessionEventTargetContext &
  Pick<ListenToAgentSessionParams, "sessionsRef" | "updateSession" | "isSessionListenerActive">;

export type SessionRuntimeDataContext = Pick<
  ListenToAgentSessionParams,
  "sessionRef" | "runtimeDataWriter"
>;

export type SessionDraftContext = SessionEventTargetContext &
  Pick<
    ListenToAgentSessionParams,
    | "draftRawBySessionRef"
    | "draftSourceBySessionRef"
    | "draftMessageIdBySessionRef"
    | "draftFlushTimeoutBySessionRef"
  >;

export type SessionTurnContext = SessionEventTargetContext &
  Pick<
    ListenToAgentSessionParams,
    | "turnModelBySessionRef"
    | "contextUsageMessageIdBySessionRef"
    | "recordTurnActivityTimestamp"
    | "recordTurnUserMessageTimestamp"
    | "resolveTurnDurationMs"
    | "clearTurnDuration"
  >;

export type SessionApprovalContext = Pick<
  ListenToAgentSessionParams,
  "adapter" | "resolveRuntimeDefinition" | "buildReadOnlyApprovalRejectionMessage"
>;

export type SessionRefreshContext = { repoPath: string } & Pick<
  ListenToAgentSessionParams,
  "refreshTaskData" | "resolveRuntimeDefinition"
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

const createStoreContext = (context: ListenToAgentSessionParams): SessionStoreContext => ({
  externalSessionId: context.sessionRef.externalSessionId,
  sessionsRef: context.sessionsRef,
  updateSession: context.updateSession,
});

const createDraftContext = (context: ListenToAgentSessionParams): SessionDraftContext => ({
  externalSessionId: context.sessionRef.externalSessionId,
  draftRawBySessionRef: context.draftRawBySessionRef,
  draftSourceBySessionRef: context.draftSourceBySessionRef,
  ...(context.draftMessageIdBySessionRef
    ? { draftMessageIdBySessionRef: context.draftMessageIdBySessionRef }
    : {}),
  ...(context.draftFlushTimeoutBySessionRef
    ? { draftFlushTimeoutBySessionRef: context.draftFlushTimeoutBySessionRef }
    : {}),
});

const createTurnContext = (context: ListenToAgentSessionParams): SessionTurnContext => ({
  externalSessionId: context.sessionRef.externalSessionId,
  ...(context.turnModelBySessionRef
    ? { turnModelBySessionRef: context.turnModelBySessionRef }
    : {}),
  ...(context.contextUsageMessageIdBySessionRef
    ? { contextUsageMessageIdBySessionRef: context.contextUsageMessageIdBySessionRef }
    : {}),
  recordTurnActivityTimestamp: context.recordTurnActivityTimestamp,
  recordTurnUserMessageTimestamp: context.recordTurnUserMessageTimestamp,
  resolveTurnDurationMs: context.resolveTurnDurationMs,
  clearTurnDuration: context.clearTurnDuration,
});

const createRuntimeDataContext = (
  context: ListenToAgentSessionParams,
): SessionRuntimeDataContext => ({
  sessionRef: context.sessionRef,
  runtimeDataWriter: context.runtimeDataWriter,
});

const createRefreshContext = (context: ListenToAgentSessionParams): SessionRefreshContext => ({
  repoPath: context.sessionRef.repoPath,
  refreshTaskData: context.refreshTaskData,
  ...(context.resolveRuntimeDefinition
    ? { resolveRuntimeDefinition: context.resolveRuntimeDefinition }
    : {}),
});

export const createSessionEventHandlerContext = (
  context: ListenToAgentSessionParams,
): SessionEventHandlerContext => {
  const store = createStoreContext(context);
  const lifecycleStore = context.isSessionListenerActive
    ? { ...store, isSessionListenerActive: context.isSessionListenerActive }
    : store;
  const drafts = createDraftContext(context);
  const turn = createTurnContext(context);
  const runtimeData = createRuntimeDataContext(context);

  return {
    lifecycle: {
      store: lifecycleStore,
      drafts,
      turn,
      approvals: {
        adapter: context.adapter,
        buildReadOnlyApprovalRejectionMessage: context.buildReadOnlyApprovalRejectionMessage,
        ...(context.resolveRuntimeDefinition
          ? { resolveRuntimeDefinition: context.resolveRuntimeDefinition }
          : {}),
      },
      runtimeData,
    },
    parts: {
      store,
      drafts,
      turn,
      refresh: createRefreshContext(context),
      runtimeData,
    },
  };
};
