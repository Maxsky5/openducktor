import type {
  AgentSessionRecord,
  TaskCard,
  WorkspaceRecord,
  WorkspaceSession,
} from "@openducktor/contracts";
import type { InlineCommentOwner } from "@openducktor/frontend-core/drafts/inline-comment-owner";
import {
  type AgentSessionIdentityLike,
  matchesAgentSessionIdentity,
} from "@openducktor/frontend-core/lib/agent-session-identity";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { normalizeWorkingDirectory } from "@openducktor/frontend-core/lib/working-directory";
import {
  workspaceSessionIdentity,
  workspaceSessionTitle,
} from "@openducktor/frontend-core/sessions/agent-orchestrator/session-read-model/workspace-session-records";
import type { SessionRouteParams } from "@/navigation/routes";
import type { WorkOwnerRef } from "./work-owner-params";

/** The session that receives Send feedback, or why no session can receive it. */
export type WorkOwnerFeedbackTarget = {
  session: SessionRouteParams | null;
  blockedReason: string | null;
  /** Reads the target again after a failed read, or null when no read failed. */
  retry: (() => void) | null;
};

/** A read that the owner needs: its data, its failure, and whether it still loads. */
export type OwnerRead<Data> = {
  data: Data | undefined;
  error: Error | null;
  isPending: boolean;
};

/** An owner resolution that still loads or that failed. */
export type PendingOwnerResolution =
  | { status: "loading"; label: string }
  | { status: "error"; title: string; message: string; canRetry: boolean };

/** The state of an owner resolution. A ready owner has all of its records. */
export type OwnerResolution<Owner> = PendingOwnerResolution | { status: "ready"; owner: Owner };

export type ResolvedTaskOwner = {
  kind: "task";
  workspace: WorkspaceRecord;
  task: TaskCard;
  commentOwner: InlineCommentOwner;
};

export type ResolvedChatOwner = {
  kind: "chat";
  workspace: WorkspaceRecord;
  record: WorkspaceSession;
  commentOwner: InlineCommentOwner;
};

const workspaceResolution = (
  workspaceId: string,
  workspaces: OwnerRead<readonly WorkspaceRecord[]>,
): OwnerResolution<WorkspaceRecord> => {
  if (workspaces.data === undefined) {
    if (workspaces.error) {
      return {
        status: "error",
        title: "Could Not Load the Workspaces",
        message: errorMessage(workspaces.error),
        canRetry: true,
      };
    }
    return { status: "loading", label: "Loading the workspace" };
  }
  const workspace = workspaces.data.find((entry) => entry.workspaceId === workspaceId);
  if (!workspace) {
    return {
      status: "error",
      title: "Workspace Not Open",
      message: "The host has no open workspace for this view. Open the workspace on the host.",
      canRetry: true,
    };
  }
  return { status: "ready", owner: workspace };
};

/** Finds the workspace and task of a task owner. */
export const resolveTaskOwner = (
  ref: Extract<WorkOwnerRef, { kind: "task" }>,
  workspaces: OwnerRead<readonly WorkspaceRecord[]>,
  tasks: OwnerRead<readonly TaskCard[]>,
): OwnerResolution<ResolvedTaskOwner> => {
  const workspace = workspaceResolution(ref.workspaceId, workspaces);
  if (workspace.status !== "ready") return workspace;
  if (tasks.data === undefined) {
    if (tasks.error) {
      return {
        status: "error",
        title: "Could Not Load the Task",
        message: errorMessage(tasks.error),
        canRetry: true,
      };
    }
    return { status: "loading", label: "Loading the task" };
  }
  const task = tasks.data.find((entry) => entry.id === ref.taskId);
  if (!task) {
    return {
      status: "error",
      title: "Task Not Found",
      message: "The task is no longer in this workspace. Go back to the task list.",
      canRetry: true,
    };
  }
  return {
    status: "ready",
    owner: {
      kind: "task",
      workspace: workspace.owner,
      task,
      commentOwner: { kind: "task", workspaceId: ref.workspaceId, taskId: task.id },
    },
  };
};

/**
 * The saved chat whose runtime session is `identity`, or null. The runtime, the external session,
 * and the working directory must match. A chat without a first message has no runtime session.
 */
export const findChatRecord = (
  records: readonly WorkspaceSession[] | undefined,
  identity: AgentSessionIdentityLike,
): WorkspaceSession | null =>
  records?.find((record) =>
    matchesAgentSessionIdentity(workspaceSessionIdentity(record), identity),
  ) ?? null;

/** Finds the workspace and saved chat of a chat owner. */
export const resolveChatOwner = (
  ref: Extract<WorkOwnerRef, { kind: "chat" }>,
  workspaces: OwnerRead<readonly WorkspaceRecord[]>,
  records: OwnerRead<readonly WorkspaceSession[]>,
): OwnerResolution<ResolvedChatOwner> => {
  const workspace = workspaceResolution(ref.workspaceId, workspaces);
  if (workspace.status !== "ready") return workspace;
  if (records.data === undefined) {
    if (records.error) {
      return {
        status: "error",
        title: "Could Not Load the Chat",
        message: errorMessage(records.error),
        canRetry: true,
      };
    }
    return { status: "loading", label: "Loading the chat" };
  }
  const record = findChatRecord(records.data, ref);
  if (!record) {
    return {
      status: "error",
      title: "Chat Not Found",
      message: "The chat is archived or no longer saved in this workspace. Go back to Chats.",
      canRetry: true,
    };
  }
  return {
    status: "ready",
    owner: {
      kind: "chat",
      workspace: workspace.owner,
      record,
      commentOwner: {
        kind: "workspace_session",
        workspaceId: ref.workspaceId,
        sessionId: record.id,
      },
    },
  };
};

const activityTime = (record: AgentSessionRecord): number =>
  record.lastActivityAt ?? (Date.parse(record.startedAt) || 0);

/**
 * The Builder session that receives task feedback: the latest Builder in the task worktree, or the
 * latest Builder when none runs there.
 */
export const pickFeedbackBuilder = (
  records: readonly AgentSessionRecord[],
  worktreePath: string | null,
): AgentSessionRecord | null => {
  const builders = records.filter((record) => record.role === "build");
  const worktree = worktreePath === null ? "" : normalizeWorkingDirectory(worktreePath);
  const inWorktree =
    worktree.length === 0
      ? []
      : builders.filter(
          (record) => normalizeWorkingDirectory(record.workingDirectory) === worktree,
        );
  const pool = inWorktree.length > 0 ? inWorktree : builders;
  return pool.toSorted((left, right) => activityTime(right) - activityTime(left))[0] ?? null;
};

/**
 * The Builder session that opens with Send feedback for a task. A failed session list read stays
 * until `retrySessions`, because a view mount does not read a failed list again.
 */
export const taskFeedbackTarget = (
  workspaceId: string,
  sessions: OwnerRead<readonly AgentSessionRecord[]>,
  worktreePath: string | null,
  retrySessions: () => void,
): WorkOwnerFeedbackTarget => {
  if (sessions.data === undefined) {
    if (sessions.error) {
      return {
        session: null,
        blockedReason: `Could not load the task sessions: ${errorMessage(sessions.error)}`,
        retry: retrySessions,
      };
    }
    return { session: null, blockedReason: "Loading the task sessions.", retry: null };
  }
  const builder = pickFeedbackBuilder(sessions.data, worktreePath);
  if (!builder) {
    return {
      session: null,
      blockedReason: "Start the Builder for this task, then send the feedback.",
      retry: null,
    };
  }
  return {
    session: {
      workspaceId,
      externalSessionId: builder.externalSessionId,
      runtimeKind: builder.runtimeKind,
      workingDirectory: builder.workingDirectory,
    },
    blockedReason: null,
    retry: null,
  };
};

/** The chat session itself receives the feedback of its work views. */
export const chatFeedbackTarget = (
  ref: Extract<WorkOwnerRef, { kind: "chat" }>,
): WorkOwnerFeedbackTarget => ({
  session: {
    workspaceId: ref.workspaceId,
    externalSessionId: ref.externalSessionId,
    runtimeKind: ref.runtimeKind,
    workingDirectory: ref.workingDirectory,
  },
  blockedReason: null,
  retry: null,
});

/** The title that the work views show for their owner. */
export const workOwnerTitle = (owner: ResolvedTaskOwner | ResolvedChatOwner): string =>
  owner.kind === "task" ? owner.task.title : workspaceSessionTitle(owner.record);
