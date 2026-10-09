import type { WorkspaceSession } from "@openducktor/contracts";
import type { GitConflict } from "@/features/agent-studio-git";
import {
  buildWorkspaceConflictPrompt,
  GitConflictRequestCancelled,
  type GitConflictAssistanceResult,
} from "@/features/git-conflict-resolution/conflict-assistance";
import { normalizeWorkingDirectory } from "@/lib/working-directory";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { WorkspaceConflictChatActions } from "./use-workspace-conflict-chat-actions";

export const requestWorkspaceGitConflictAssistance = async (input: {
  workspace: ActiveWorkspace;
  record: WorkspaceSession;
  actions: WorkspaceConflictChatActions | null;
  conflict: GitConflict;
  assertCurrent: () => void;
}): Promise<GitConflictAssistanceResult> => {
  const { workspace, record, actions, conflict, assertCurrent } = input;
  assertCurrent();
  if (
    !actions ||
    actions.workspace.workspaceId !== workspace.workspaceId ||
    actions.workspace.repoPath !== workspace.repoPath ||
    actions.record.id !== record.id
  )
    throw new Error("The selected chat is not ready. Wait for session data or reload the chat.");
  if (actions.blockedReason) throw new Error(actions.blockedReason);
  const recipientBlocker = workspaceConflictRecipientBlockedReason(record);
  if (recipientBlocker) throw new Error(recipientBlocker);
  if (
    normalizeWorkingDirectory(conflict.workingDir) !==
    normalizeWorkingDirectory(record.executionTarget.workingDirectory)
  )
    throw new Error(
      "Select the chat for the conflict directory or restore this chat's saved target.",
    );
  try {
    return await actions.send([{ kind: "text", text: buildWorkspaceConflictPrompt(conflict) }], {
      assertCurrent,
      assertCanSubmit: actions.assertCanSubmit,
    });
  } catch (cause) {
    if (cause instanceof GitConflictRequestCancelled) return false;
    throw cause;
  }
};

export const workspaceConflictChatKey = (workspaceId: string, savedChatId: string): string =>
  JSON.stringify([workspaceId, savedChatId]);

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
