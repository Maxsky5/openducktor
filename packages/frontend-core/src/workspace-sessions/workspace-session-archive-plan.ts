import type {
  WorkspaceSession,
  WorkspaceSessionArchiveInput,
  WorkspaceSessionArchivePreview,
} from "@openducktor/contracts";

/**
 * Archive rules for a chat. The archive form itself is the consent to stop the running work of
 * the chat, so the archive request always confirms the stop. Each client renders these decisions
 * and words with its own controls.
 */
export const ARCHIVE_CHAT_TEXT = {
  title: "Archive chat",
  description: "Move this chat to Archived chats. You can restore it later.",
  stopsWork:
    "Archiving stops this chat's terminals, development servers, and its running session. Your chat history stays available in Archived chats.",
  repositoryFilesStay: "Your repository files will stay on disk.",
  removeWorktree: "Remove worktree and branch",
  checkingChanges: "Checking worktree changes…",
  checkingWorktree: "Checking the worktree…",
  retryCheck: "Retry check",
  confirm: "Archive chat",
  confirming: "Archiving…",
} as const;

/** The archive preview read as the archive form uses it. */
export type WorkspaceSessionArchivePreviewRead = {
  data: WorkspaceSessionArchivePreview | undefined;
  isSuccess: boolean;
  isFetching: boolean;
};

export type WorktreeArchiveConfirmation = NonNullable<
  WorkspaceSessionArchiveInput["worktreeConfirmation"]
>;

/** Only a chat in its own worktree offers worktree removal. Removal starts turned on. */
export const isWorktreeChat = (record: WorkspaceSession): boolean =>
  record.executionTarget.kind === "local_worktree";

/** The saved chats that need the worktree of this chat for files or history. */
const worktreeSharedWith = (preview: WorkspaceSessionArchivePreviewRead) =>
  preview.data?.sharedWith ?? [];

/** The open tasks that need the worktree of this chat. */
const worktreeTaskOwners = (preview: WorkspaceSessionArchivePreviewRead) =>
  preview.data?.taskOwners ?? [];

/** True when other saved chats or open tasks need the worktree, so it stays. */
export const isWorktreeNeeded = (preview: WorkspaceSessionArchivePreviewRead): boolean =>
  worktreeSharedWith(preview).length > 0 || worktreeTaskOwners(preview).length > 0;

/**
 * A worktree that other saved chats or open tasks need stays, whatever the form asks. Nothing is
 * removed while the worktree check runs.
 */
export const effectiveWorktreeRemoval = (
  wantsRemoval: boolean,
  preview: WorkspaceSessionArchivePreviewRead,
  checking: boolean,
): boolean => !checking && wantsRemoval && !isWorktreeNeeded(preview);

/** Names the saved chats that keep the worktree, or null when no other chat needs it. */
export const sharedWorktreeNotice = (
  preview: WorkspaceSessionArchivePreviewRead,
): string | null => {
  const sharedWith = worktreeSharedWith(preview);
  if (sharedWith.length === 0) return null;
  return `This worktree stays because these saved chats need it for files or history: ${sharedWith.map((owner) => owner.title).join(", ")}.`;
};

/** Names the open tasks that keep the worktree, or null when no task needs it. */
export const taskWorktreeNotice = (preview: WorkspaceSessionArchivePreviewRead): string | null => {
  const taskOwners = worktreeTaskOwners(preview);
  if (taskOwners.length === 0) return null;
  return `This worktree stays because these tasks need it: ${taskOwners.map((task) => `${task.title} (${task.taskId})`).join(", ")}.`;
};

/**
 * A chat archives after the worktree check ends. Worktree removal needs a preview that names the
 * branch to delete.
 */
export const canArchiveWorkspaceSession = ({
  record,
  removeWorktree,
  preview,
  isArchiving,
  checking,
}: {
  record: WorkspaceSession;
  removeWorktree: boolean;
  preview: WorkspaceSessionArchivePreviewRead;
  isArchiving: boolean;
  /** True while the worktree check runs. */
  checking: boolean;
}): boolean => {
  if (isArchiving || checking) return false;
  if (!isWorktreeChat(record) || !removeWorktree) return true;
  return preview.isSuccess && preview.data !== undefined && preview.data.branchName !== null;
};

/** The host deletes only the worktree and branch that the user saw in the form. */
export const worktreeArchiveConfirmation = (
  record: WorkspaceSession,
  removeWorktree: boolean,
  preview: WorkspaceSessionArchivePreviewRead,
): WorktreeArchiveConfirmation | undefined => {
  const branchName = preview.data?.branchName;
  if (!removeWorktree || !branchName) return undefined;
  return { workingDirectory: record.executionTarget.workingDirectory, branchName };
};

export type WorktreeArchiveNotice =
  | { kind: "keep"; text: string }
  | { kind: "no_branch"; text: string }
  /** The branch name is null until the preview names it. */
  | { kind: "delete_branch"; branchName: string | null; consequence: string };

export const worktreeArchiveNotice = (
  removeWorktree: boolean,
  preview: WorkspaceSessionArchivePreviewRead,
): WorktreeArchiveNotice => {
  if (!removeWorktree) {
    let text = "The worktree and its branch will stay on disk.";
    if (preview.data?.worktreeExists === false) {
      text =
        preview.data.branchName === null
          ? "The worktree is missing. Restore the worktree at this path before restoring the chat."
          : "The worktree is missing. Restoring this chat creates a fresh worktree from the default branch.";
    }
    return { kind: "keep", text };
  }
  if (preview.isSuccess && preview.data?.branchName === null) {
    return {
      kind: "no_branch",
      text: "No branch is attached. Turn off worktree removal to archive this chat.",
    };
  }
  return {
    kind: "delete_branch",
    branchName: preview.data?.branchName ?? null,
    consequence:
      "will be deleted. Commits that exist only on this branch may be lost. Restoring this chat creates a fresh worktree from the chat's target branch. It does not recover deleted changes.",
  };
};

export type WorktreeArchiveWarning = {
  kind: "local_changes" | "worktree_missing";
  text: string;
};

/** Warnings about data that worktree removal deletes or cannot find. */
export const worktreeArchiveWarnings = (
  removeWorktree: boolean,
  preview: WorkspaceSessionArchivePreview | undefined,
): WorktreeArchiveWarning[] => {
  if (!removeWorktree || !preview) return [];
  const warnings: WorktreeArchiveWarning[] = [];
  if (preview.hasUncommittedChanges) {
    warnings.push({
      kind: "local_changes",
      text: "This worktree has local changes. Removing it will permanently discard them, including untracked files.",
    });
  }
  if (!preview.worktreeExists) {
    warnings.push({
      kind: "worktree_missing",
      text:
        preview.branchName === null
          ? "The worktree is already missing."
          : "The worktree is already missing. Archiving will finish removing its branch if it still exists.",
    });
  }
  return warnings;
};
