import type { AgentChatTranscriptNotice } from "../../sessions/send/agent-chat.types";

/** Shows while the first message of an unnamed chat worktree waits for its final branch. */
export const BRANCH_NAMING_NOTICE: AgentChatTranscriptNotice = {
  kind: "branch_naming",
  severity: "loading",
  title: "Naming the branch",
  description:
    "OpenDucktor names the branch from your message. The agent starts on the final branch.",
};
