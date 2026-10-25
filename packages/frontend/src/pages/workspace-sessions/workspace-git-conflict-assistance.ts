import type { WorkspaceSession } from "@openducktor/contracts";
import type { GitConflict } from "@openducktor/frontend-core/git/contracts";
import {
  buildWorkspaceConflictPrompt,
  chatConflictBlockedReason,
  GitConflictRequestCancelled,
  type GitConflictAssistanceResult,
} from "@openducktor/frontend-core/git/conflicts/conflict-assistance";
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
  const recipientBlocker = chatConflictBlockedReason(record, conflict);
  if (recipientBlocker) throw new Error(recipientBlocker);
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
