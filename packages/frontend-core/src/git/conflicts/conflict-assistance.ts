import type { RepoPromptOverrides, WorkspaceSession } from "@openducktor/contracts";
import {
  buildGitConflictAssistancePrompt,
  type BuiltinTaskCard as TaskCard,
} from "@openducktor/workflows";
import { matchesAgentSessionIdentity } from "../../lib/agent-session-identity";
import { normalizeWorkingDirectory } from "../../lib/working-directory";
import type { AgentMessageSendReceipt, AgentSessionIdentity } from "../../types/agent-orchestrator";
import type { GitConflict } from "../contracts";

/** The launch action of a Builder session that resolves a rebase conflict. */
export const BUILD_REBASE_CONFLICT_RESOLUTION_LAUNCH_ACTION =
  "build_rebase_conflict_resolution" as const;

export class GitConflictRequestCancelled extends Error {
  constructor() {
    super(
      "The selected chat or conflict directory changed. Ask for assistance again in the current chat.",
    );
    this.name = "GitConflictRequestCancelled";
  }
}

export type GitConflictAssistanceResult = AgentMessageSendReceipt | false;
export type ResolveGitConflict = (
  conflict: GitConflict,
  assertCurrent?: () => void,
) => Promise<GitConflictAssistanceResult>;

export const conflictRequestContext = (conflict: GitConflict) => {
  if (!conflict.operation || !conflict.workingDir?.trim())
    throw new Error(
      "Restore the Git conflict operation and working directory before asking for assistance.",
    );
  return {
    operation: conflict.operation,
    workingDirectory: conflict.workingDir,
    currentBranch: conflict.currentBranch,
    targetBranch: conflict.targetBranch || null,
    conflictedFiles: conflict.conflictedFiles,
    conflictOutput: conflict.output || null,
  };
};

export const buildWorkspaceConflictPrompt = (conflict: GitConflict): string =>
  buildGitConflictAssistancePrompt({ git: conflictRequestContext(conflict) });

/** Tells why a saved workspace chat cannot receive a conflict request, or null when it can. */
export const workspaceConflictRecipientBlockedReason = (
  record: WorkspaceSession,
): string | null => {
  if (record.archivedAt !== null)
    return "Restore the saved workspace chat before asking for assistance.";
  if (
    !record.executionTarget.workingDirectory.trim() ||
    (record.executionTarget.kind === "local_worktree" &&
      record.executionTarget.worktreeState === "removed")
  )
    return "Restore this chat's saved working directory before asking for assistance.";
  return null;
};

/** Why a chat cannot work on a conflict: the chat works in another directory. */
export const CHAT_CONFLICT_DIRECTORY_MISMATCH_REASON =
  "Select the chat for the conflict directory or restore this chat's saved target.";

/**
 * Why a saved workspace chat cannot receive a conflict request, or null when it can. The chat must
 * be saved, keep its directory, and work in the conflict directory.
 */
export const chatConflictBlockedReason = (
  record: WorkspaceSession,
  conflict: GitConflict,
): string | null =>
  workspaceConflictRecipientBlockedReason(record) ??
  (normalizeWorkingDirectory(conflict.workingDir) !==
  normalizeWorkingDirectory(record.executionTarget.workingDirectory)
    ? CHAT_CONFLICT_DIRECTORY_MISMATCH_REASON
    : null);

/**
 * The Builder sessions that can resolve a conflict: the sessions in the conflict directory. The
 * default is the current session when it is one of them, or the first one.
 */
export type ConflictBuilderSessions<Session> = {
  /** The Builder sessions in the conflict directory. */
  matching: Session[];
  defaultBuilder: Session | null;
};

export const conflictBuilderSessions = <Session extends AgentSessionIdentity>(
  conflict: GitConflict,
  builderSessions: readonly Session[],
  currentSession: AgentSessionIdentity | null,
): ConflictBuilderSessions<Session> => {
  const workingDirectory = normalizeWorkingDirectory(conflict.workingDir);
  const matching = builderSessions.filter(
    (session) => normalizeWorkingDirectory(session.workingDirectory) === workingDirectory,
  );
  const defaultBuilder =
    matching.find((session) => matchesAgentSessionIdentity(session, currentSession)) ??
    matching[0] ??
    null;
  return { matching, defaultBuilder };
};

/** The conflict request for the Builder of a task, with the task context and prompt overrides. */
export const buildTaskConflictPrompt = ({
  conflict,
  taskId,
  task,
  overrides,
}: {
  conflict: GitConflict;
  taskId: string;
  task: TaskCard | null;
  overrides: RepoPromptOverrides;
}): string => {
  const taskPrompt: NonNullable<Parameters<typeof buildGitConflictAssistancePrompt>[0]["task"]> = {
    overrides,
    context: { taskId },
  };
  if (task) {
    taskPrompt.context = {
      taskId,
      title: task.title,
      issueType: task.issueType,
      status: task.status,
      description: task.description,
    };
  }
  return buildGitConflictAssistancePrompt({
    git: conflictRequestContext(conflict),
    task: taskPrompt,
  });
};

/** What the user learns after a conflict request reached the agent. */
export type ConflictRequestOutcome =
  | { kind: "sent"; title: string }
  | { kind: "host_step_failed"; title: string; message: string; detail: string }
  | { kind: "uncertain"; title: string; message: string };

/** The result of an accepted, queued, or uncertain conflict request. */
export const describeConflictRequestReceipt = (
  receipt: AgentMessageSendReceipt,
  recipientLabel: string,
): ConflictRequestOutcome => {
  if (
    (receipt.outcome === "accepted" || receipt.outcome === "acknowledged") &&
    receipt.postAcceptanceFailure
  ) {
    return {
      kind: "host_step_failed",
      title: `Message accepted by ${recipientLabel}; host step failed`,
      message: `The agent accepted the message, but a later host step failed: ${receipt.postAcceptanceFailure}`,
      detail: receipt.postAcceptanceFailure,
    };
  }
  if (receipt.outcome === "uncertain") {
    return {
      kind: "uncertain",
      title: "Conflict resolution request has no confirmed result",
      message:
        "Delivery of the conflict resolution request is uncertain. Inspect the original session before sending it again.",
    };
  }
  const queued =
    receipt.outcome === "queued" ||
    (receipt.outcome === "accepted" &&
      receipt.acceptedMessage.type === "user_message" &&
      receipt.acceptedMessage.state === "queued");
  return {
    kind: "sent",
    title: queued
      ? `Queued git conflict resolution request for ${recipientLabel}`
      : `Sent git conflict resolution request to ${recipientLabel}`,
  };
};
