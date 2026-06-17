import type { AgentSessionRecord } from "@openducktor/contracts";
import { formatWorkflowAgentSessionTitle } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "./messages";
import { normalizePersistedSelection } from "./models";
import {
  readPersistedSelectedModelRuntimeKind,
  readPersistedSessionRuntimeKind,
  readSessionSelectedModelRuntimeKindForPersistence,
} from "./session-runtime-kind";
import { isWorkflowAgentSession } from "./workflow-session";

export const toPersistedSessionRecord = (session: AgentSessionState): AgentSessionRecord => {
  if (!isWorkflowAgentSession(session)) {
    throw new Error(`Session '${session.externalSessionId}' is not a workflow session.`);
  }
  const runtimeKind = session.runtimeKind;

  return {
    externalSessionId: session.externalSessionId,
    role: session.role,
    startedAt: session.startedAt,
    runtimeKind,
    workingDirectory: session.workingDirectory,
    selectedModel: session.selectedModel
      ? {
          runtimeKind: readSessionSelectedModelRuntimeKindForPersistence(
            session.externalSessionId,
            runtimeKind,
            session.selectedModel,
          ),
          providerId: session.selectedModel.providerId,
          modelId: session.selectedModel.modelId,
          ...(session.selectedModel.variant ? { variant: session.selectedModel.variant } : {}),
          ...(session.selectedModel.profileId
            ? { profileId: session.selectedModel.profileId }
            : {}),
        }
      : null,
  };
};

export type PersistedTaskSessionRecord = {
  taskId: string;
  record: AgentSessionRecord;
};

export const fromPersistedSessionRecord = ({
  taskId,
  record,
}: PersistedTaskSessionRecord): AgentSessionState => {
  const runtimeKind = readPersistedSessionRuntimeKind(record);

  return {
    externalSessionId: record.externalSessionId,
    title: formatWorkflowAgentSessionTitle(record.role, taskId),
    taskId,
    role: record.role,
    // Persisted task-store records are durable session fields only. Cold reads
    // start idle; mounted refreshes may preserve current live state separately.
    status: "idle",
    startedAt: record.startedAt,
    runtimeKind,
    workingDirectory: record.workingDirectory,
    historyLoadState: "not_requested",
    messages: createSessionMessagesState(record.externalSessionId),
    contextUsage: null,
    pendingApprovals: [],
    pendingQuestions: [],
    selectedModel: record.selectedModel
      ? normalizePersistedSelection({
          ...record.selectedModel,
          runtimeKind: readPersistedSelectedModelRuntimeKind(
            record.externalSessionId,
            runtimeKind,
            record.selectedModel,
          ),
        })
      : null,
  };
};
