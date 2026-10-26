import type { WorkspaceRecord, WorkspaceSession } from "@openducktor/contracts";
import type { ArchiveWorkspaceSessionInput } from "@openducktor/frontend-core/workspace-sessions/use-archive-workspace-session";
import {
  ARCHIVE_CHAT_TEXT,
  canArchiveWorkspaceSession,
  effectiveWorktreeRemoval,
  isWorktreeChat,
  sharedWorktreeNotice,
  taskWorktreeNotice,
  type WorkspaceSessionArchivePreviewRead,
  type WorktreeArchiveNotice,
  type WorktreeArchiveWarning,
  worktreeArchiveConfirmation,
  worktreeArchiveNotice,
  worktreeArchiveWarnings,
} from "@openducktor/frontend-core/workspace-sessions/workspace-session-archive-plan";

export type ArchiveChatForm = {
  /** Only a chat in its own worktree offers to remove the worktree and its branch. */
  offersWorktreeRemoval: boolean;
  /** The removal that the archive does: off while other chats or tasks need the worktree. */
  removeWorktree: boolean;
  /** Names the saved chats that keep the worktree, or null when no other chat needs it. */
  sharedNotice: string | null;
  /** Names the open tasks that keep the worktree, or null when no task needs it. */
  taskNotice: string | null;
  canArchive: boolean;
  /** The confirm button reads as destructive while it deletes a worktree. */
  destructive: boolean;
  notice: WorktreeArchiveNotice;
  warnings: WorktreeArchiveWarning[];
};

/** The archive sheet follows the desktop archive dialog rules. */
export const archiveChatForm = ({
  record,
  wantsWorktreeRemoval,
  preview,
  isArchiving,
}: {
  record: WorkspaceSession;
  /** The switch choice. A worktree that other chats or tasks need stays anyway. */
  wantsWorktreeRemoval: boolean;
  preview: WorkspaceSessionArchivePreviewRead;
  isArchiving: boolean;
}): ArchiveChatForm => {
  const offersWorktreeRemoval = isWorktreeChat(record);
  // The sheet shows its loader while the worktree check runs, so the check holds the archive.
  const checking = offersWorktreeRemoval && preview.isFetching;
  const removeWorktree = effectiveWorktreeRemoval(wantsWorktreeRemoval, preview, checking);
  return {
    offersWorktreeRemoval,
    removeWorktree,
    sharedNotice: offersWorktreeRemoval ? sharedWorktreeNotice(preview) : null,
    taskNotice: offersWorktreeRemoval ? taskWorktreeNotice(preview) : null,
    canArchive: canArchiveWorkspaceSession({
      record,
      removeWorktree,
      preview,
      isArchiving,
      checking,
    }),
    destructive: offersWorktreeRemoval && removeWorktree,
    notice: offersWorktreeRemoval
      ? worktreeArchiveNotice(removeWorktree, preview)
      : { kind: "keep", text: ARCHIVE_CHAT_TEXT.repositoryFilesStay },
    warnings: offersWorktreeRemoval ? worktreeArchiveWarnings(removeWorktree, preview.data) : [],
  };
};

/**
 * The archive request. The user saw that archiving stops the running work of the chat, so the
 * request confirms the stop.
 */
export const archiveChatInput = ({
  workspace,
  record,
  wantsWorktreeRemoval,
  preview,
}: {
  workspace: Pick<WorkspaceRecord, "workspaceId" | "repoPath">;
  record: WorkspaceSession;
  wantsWorktreeRemoval: boolean;
  preview: WorkspaceSessionArchivePreviewRead;
}): ArchiveWorkspaceSessionInput => {
  const removes =
    isWorktreeChat(record) &&
    effectiveWorktreeRemoval(wantsWorktreeRemoval, preview, preview.isFetching);
  return {
    workspaceId: workspace.workspaceId,
    repoPath: workspace.repoPath,
    sessionId: record.id,
    confirmStop: true,
    removeWorktree: removes,
    worktreeConfirmation: worktreeArchiveConfirmation(record, removes, preview),
  };
};
