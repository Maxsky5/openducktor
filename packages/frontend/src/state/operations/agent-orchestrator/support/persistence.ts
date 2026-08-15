import type { AgentSessionRecord } from "@openducktor/contracts";
import { formatWorkflowAgentSessionTitle, requireSessionWorkingDirectory } from "@openducktor/core";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import { createSessionMessagesState } from "./messages";
import { normalizePersistedSelection } from "./models";
import {
  readPersistedSessionRuntimeKind,
  readSelectedModelRuntimeKind,
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
          runtimeKind: readSelectedModelRuntimeKind(
            `Session '${session.externalSessionId}'`,
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

export const toPersistedSessionIdentity = (record: AgentSessionRecord): AgentSessionIdentity => ({
  externalSessionId: record.externalSessionId,
  runtimeKind: readPersistedSessionRuntimeKind(record),
  workingDirectory: requireSessionWorkingDirectory(
    record.workingDirectory,
    `read persisted session '${record.externalSessionId}'`,
  ),
});

export const fromPersistedSessionRecord = ({
  taskId,
  record,
}: PersistedTaskSessionRecord): AgentSessionState => {
  const identity = toPersistedSessionIdentity(record);

  return {
    externalSessionId: identity.externalSessionId,
    title: formatWorkflowAgentSessionTitle(record.role, taskId),
    taskId,
    role: record.role,
    // Persisted task-store records are durable session fields only. Cold reads
    // start idle; mounted refreshes may preserve current live state separately.
    status: "idle",
    runtimeStatusMessage: null,
    startedAt: record.startedAt,
    runtimeKind: identity.runtimeKind,
    workingDirectory: identity.workingDirectory,
    historyLoadState: "not_requested",
    messages: createSessionMessagesState(identity.externalSessionId),
    contextUsage: null,
    contextUsageError: null,
    pendingApprovals: [],
    pendingQuestions: [],
    selectedModel: record.selectedModel
      ? normalizePersistedSelection({
          ...record.selectedModel,
          runtimeKind: readSelectedModelRuntimeKind(
            `Persisted session '${identity.externalSessionId}'`,
            identity.runtimeKind,
            record.selectedModel,
          ),
        })
      : null,
  };
};

export const toPersistedSessionView = ({
  taskId,
  record,
  current,
}: PersistedTaskSessionRecord & {
  current?: AgentSessionState | undefined;
}): AgentSessionState => {
  const persisted = fromPersistedSessionRecord({ taskId, record });
  if (!current) {
    return persisted;
  }

  return {
    ...current,
    taskId: persisted.taskId,
    runtimeKind: persisted.runtimeKind,
    role: persisted.role,
    startedAt: persisted.startedAt,
    workingDirectory: persisted.workingDirectory,
    selectedModel: persisted.selectedModel,
  };
};
