import type { WorkspaceSession } from "@openducktor/contracts";
import {
  getAgentSession,
  listAgentSessions,
  replaceAgentSession,
  type AgentSessionCollection,
} from "@/state/agent-session-collection";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentSessionTransientFault } from "@/types/agent-session-transient-fault";
import type { ActiveWorkspace } from "@/types/state-slices";
import { agentSessionRefKey, initialSpeedState } from "@openducktor/core";
import { createSessionMessagesState } from "../support/messages";

export const workspaceSessionIdentity = (record: WorkspaceSession): AgentSessionIdentity | null =>
  record.externalSessionId === null
    ? null
    : {
        runtimeKind: record.runtimeKind,
        externalSessionId: record.externalSessionId,
        workingDirectory: record.executionTarget.workingDirectory,
      };

export const workspaceSessionTitle = (record: WorkspaceSession): string =>
  record.manualTitle ?? record.generatedTitle ?? "Untitled session";

export const workspaceSessionWorkingDirectory = (
  _workspace: Pick<ActiveWorkspace, "repoPath">,
  record: WorkspaceSession,
): string | null => record.executionTarget.workingDirectory || null;

export const workspaceSessionTargetFaultKey = (
  repoPath: string,
  identity: AgentSessionIdentity,
): string => `workspace-target:${agentSessionRefKey({ repoPath, ...identity })}`;

export const reconcileWorkspaceSessionTargetFaults = (
  current: ReadonlyMap<string, AgentSessionTransientFault>,
  collection: AgentSessionCollection,
  records: readonly WorkspaceSession[],
  repoPath: string,
): ReadonlyMap<string, AgentSessionTransientFault> => {
  const next = new Map([...current].filter(([, fault]) => fault.source !== "workspace-target"));
  const sessions = listAgentSessions(collection);
  for (const record of records) {
    const identity = workspaceSessionIdentity(record);
    if (!identity) continue;
    const wrongDirectory = sessions.find(
      (entry) =>
        entry.runtimeKind === record.runtimeKind &&
        entry.externalSessionId === record.externalSessionId &&
        entry.workingDirectory !== identity.workingDirectory &&
        entry.livePresence === "present",
    );
    if (wrongDirectory)
      next.set(workspaceSessionTargetFaultKey(repoPath, identity), {
        source: "workspace-target",
        message: `Runtime session directory '${wrongDirectory.workingDirectory}' does not match stored target '${identity.workingDirectory}'.`,
      });
  }
  if (
    next.size === current.size &&
    [...next].every(([key, fault]) => {
      const previous = current.get(key);
      return previous?.message === fault.message && previous.source === fault.source;
    })
  )
    return current;
  return next;
};

export const applyWorkspaceSessionRecords = (
  projected: AgentSessionCollection,
  records: readonly WorkspaceSession[],
  previous: AgentSessionCollection = projected,
): AgentSessionCollection => {
  let collection = projected;
  for (const record of records) {
    const identity = workspaceSessionIdentity(record);
    if (!identity) continue;
    const current = getAgentSession(projected, identity);
    const prior = getAgentSession(previous, identity);
    let session: AgentSessionState;
    if (current) {
      session = current;
    } else if (prior) {
      session = {
        ...prior,
        status: "idle",
        livePresence: "absent",
        pendingApprovals: [],
        pendingQuestions: [],
        contextUsage: null,
        pendingUserMessageStartedAt: undefined,
        runtimeStatusMessage: null,
      };
    } else {
      session = {
        ...identity,
        sessionAssociation: { kind: "repository" },
        status: "idle",
        livePresence: "unobserved",
        startedAt: new Date(record.createdAt).toISOString(),
        historyLoadState: "not_requested",
        messages: createSessionMessagesState(identity.externalSessionId),
        runtimeStatusMessage: null,
        contextUsage: null,
        pendingApprovals: [],
        pendingQuestions: [],
        selectedModel: null,
      };
    }
    const next: AgentSessionState = {
      ...session,
      sessionAssociation: { kind: "repository" },
      title: workspaceSessionTitle(record),
      selectedModel: record.selectedModel ?? session.selectedModel,
      speed:
        current?.speed &&
        (current.livePresence === "present" || current.speed.choice === record.speed)
          ? current.speed
          : initialSpeedState(record.speed),
    };
    collection = replaceAgentSession(collection, next);
  }
  return collection;
};
