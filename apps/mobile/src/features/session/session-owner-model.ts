import type {
  AgentSessionAssociation,
  AgentSessionScope,
  WorkspaceSession,
} from "@openducktor/contracts";
import type { AgentSessionIdentity } from "@openducktor/frontend-core/types/agent-orchestrator";
import { builtinRoleId } from "@openducktor/workflows";
import type { AgentSessionReadModelLoadState } from "@openducktor/frontend-core/types/agent-session-read-model";
import {
  findChatRecord,
  type PendingOwnerResolution,
} from "@/features/work-owner/work-owner-model";
import type { WorkOwnerParams } from "@/navigation/routes";
import type { SessionOwner } from "./session-target";

/** A query result as the resolver needs it. */
export type RecordsRead = {
  data: readonly WorkspaceSession[] | undefined;
  error: string | null;
  isPending: boolean;
};

export type SessionOwnerResolution =
  | PendingOwnerResolution
  | {
      status: "ready";
      owner: SessionOwner;
      sessionAssociation: AgentSessionAssociation;
      sessionScope: AgentSessionScope | null;
    };

const UNBOUND: AgentSessionAssociation = Object.freeze({ kind: "unbound" });
const REPOSITORY: AgentSessionAssociation = Object.freeze({ kind: "repository" });
const REPOSITORY_SCOPE: AgentSessionScope = Object.freeze({ kind: "repository" });
const NO_OWNER: SessionOwnerResolution = {
  status: "ready",
  owner: { kind: "none" },
  sessionAssociation: UNBOUND,
  sessionScope: null,
};

// A resolution stays the same object while its chat record or task association does. Query
// results keep unchanged records, so an update of another chat does not render this session again.
const chatResolutions = new WeakMap<WorkspaceSession, SessionOwnerResolution>();
const taskResolutions = new WeakMap<AgentSessionAssociation, SessionOwnerResolution>();

const chatOwner = (record: WorkspaceSession): SessionOwnerResolution => {
  let resolution = chatResolutions.get(record);
  if (!resolution) {
    resolution = {
      status: "ready",
      owner: { kind: "chat", record },
      sessionAssociation: REPOSITORY,
      sessionScope: REPOSITORY_SCOPE,
    };
    chatResolutions.set(record, resolution);
  }
  return resolution;
};

const taskOwner = (
  association: Extract<AgentSessionAssociation, { kind: "workflow" }>,
): SessionOwnerResolution => {
  let resolution = taskResolutions.get(association);
  if (!resolution) {
    resolution = {
      status: "ready",
      owner: { kind: "task", taskId: association.taskId, role: builtinRoleId(association.role) },
      sessionAssociation: association,
      sessionScope: { kind: "workflow", taskId: association.taskId, role: association.role },
    };
    taskResolutions.set(association, resolution);
  }
  return resolution;
};

/**
 * Finds the task or chat that owns a session. A task session names its task in the session
 * store. A chat is the saved Workspace Session whose runtime session matches. A Read-only
 * Session View of a Subagent can have no owner.
 */
export const resolveSessionOwner = ({
  identity,
  readOnly,
  association,
  readModelLoadState,
  activeChats,
  archivedChats,
}: {
  identity: AgentSessionIdentity;
  readOnly: boolean;
  /** The association that the session store holds, or null when the store has no session. */
  association: AgentSessionAssociation | null;
  readModelLoadState: AgentSessionReadModelLoadState;
  activeChats: RecordsRead;
  /** Read only when the active chats do not hold the session. */
  archivedChats: RecordsRead;
}): SessionOwnerResolution => {
  if (association?.kind === "workflow") return taskOwner(association);
  if (readOnly) return NO_OWNER;
  const activeRecord = findChatRecord(activeChats.data, identity);
  if (activeRecord) return chatOwner(activeRecord);
  if (activeChats.error) {
    return {
      status: "error",
      title: "Chats could not load",
      message: activeChats.error,
      canRetry: true,
    };
  }
  if (activeChats.isPending) return { status: "loading", label: "Loading session" };
  const archivedRecord = findChatRecord(archivedChats.data, identity);
  if (archivedRecord) return chatOwner(archivedRecord);
  if (archivedChats.error) {
    return {
      status: "error",
      title: "Chats could not load",
      message: archivedChats.error,
      canRetry: true,
    };
  }
  if (archivedChats.isPending || readModelLoadState.kind === "loading") {
    return { status: "loading", label: "Loading session" };
  }
  if (readModelLoadState.kind === "failed") {
    return {
      status: "error",
      title: "Sessions could not load",
      message: readModelLoadState.message,
      canRetry: true,
    };
  }
  if (association?.kind === "repository") {
    return {
      status: "error",
      title: "This chat is not saved",
      message: "The host has no saved chat for this session. Open the chat again from Chats.",
      canRetry: false,
    };
  }
  return {
    status: "error",
    title: "Session not found",
    message:
      "The host does not list this session for the workspace. It may have been removed. Open the session again from its task or chat.",
    canRetry: true,
  };
};

/** The fields of an owner that its work views need. */
export type WorkOwnerSource = { kind: "task"; taskId: string } | { kind: "chat" | "none" };

/** The work views of the owner. A chat names its runtime session; a task names the task. */
export const workOwnerParamsFor = (
  workspaceId: string,
  owner: WorkOwnerSource,
  identity: AgentSessionIdentity,
): WorkOwnerParams | null => {
  if (owner.kind === "task") return { workspaceId, taskId: owner.taskId };
  if (owner.kind === "chat") {
    return {
      workspaceId,
      externalSessionId: identity.externalSessionId,
      runtimeKind: identity.runtimeKind,
      workingDirectory: identity.workingDirectory,
    };
  }
  return null;
};
