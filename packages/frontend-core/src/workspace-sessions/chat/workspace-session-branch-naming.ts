import type { WorkspaceSession } from "@openducktor/contracts";
import type { AgentChatTranscriptNotice } from "../../sessions/send/agent-chat.types";

/** The hexadecimal digits of the folder and the temporary branch of an unnamed chat worktree. */
const AUTOMATIC_NAME_LENGTH = 8;

/**
 * A chat in the automatic worktree folder of its session ID, on the temporary branch of the same
 * digits, before its first message. The host names that branch from the first message before the
 * agent starts.
 */
export const hasTemporaryWorktreeBranch = (
  record: Pick<WorkspaceSession, "id" | "executionTarget" | "lastActivityAt">,
): boolean => {
  const target = record.executionTarget;
  if (target.kind !== "local_worktree" || target.branchName === null) return false;
  if (record.lastActivityAt !== undefined) return false;
  const digits = record.id.replace(/-/g, "").slice(0, AUTOMATIC_NAME_LENGTH).toLowerCase();
  return (
    target.workingDirectory.split(/[\\/]/).at(-1) === digits &&
    target.branchName.split("/").at(-1) === digits
  );
};

/** Shows while the first message of an unnamed chat worktree waits for its final branch. */
export const BRANCH_NAMING_NOTICE: AgentChatTranscriptNotice = {
  kind: "branch_naming",
  severity: "loading",
  title: "Naming the branch",
  description:
    "OpenDucktor names the branch from your message. The agent starts on the final branch.",
};
