import { hasAutomaticWorktreeBranch, type WorkspaceSession } from "@openducktor/contracts";
import type { AgentChatTranscriptNotice } from "../../sessions/send/agent-chat.types";
import type { AgentSessionState } from "../../types/agent-orchestrator";

/** Shows while the first message of an unnamed chat worktree waits for its final branch. */
export const BRANCH_NAMING_NOTICE: AgentChatTranscriptNotice = {
  kind: "branch_naming",
  severity: "loading",
  title: "Naming the branch",
  description:
    "OpenDucktor names the branch from your message. The agent starts on the final branch.",
};

/**
 * The notice of a chat whose first message waits while the host names its branch, or null. The
 * host saves the final branch before the agent gets the message, so the notice ends when the chat
 * record has its final branch.
 */
export const branchNamingNotice = (
  record: Pick<WorkspaceSession, "id" | "executionTarget" | "lastActivityAt">,
  session: Pick<AgentSessionState, "pendingUserMessageStartedAt"> | null,
): AgentChatTranscriptNotice | null =>
  session?.pendingUserMessageStartedAt !== undefined && hasAutomaticWorktreeBranch(record)
    ? BRANCH_NAMING_NOTICE
    : null;
