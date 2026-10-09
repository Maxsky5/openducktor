import type {
  WorkflowLaunchSnapshot,
  WorkspaceSessionLaunchSnapshot,
} from "@openducktor/contracts";
import { clearAgentChatDraft } from "@/components/features/agents/agent-chat/agent-chat-draft-store";

type Launch = WorkflowLaunchSnapshot | WorkspaceSessionLaunchSnapshot;

/** Clear only the failed instruction that this launch later accepted. */
export const updateSessionLaunchDraft = (launch: Launch): void => {
  if (launch.acceptance === "accepted") {
    const identity =
      "taskId" in launch
        ? launch.session && {
            workspaceId: launch.workspaceId,
            externalSessionId: launch.session.externalSessionId,
            runtimeKind: launch.session.runtimeKind,
            workingDirectory: launch.session.workingDirectory,
          }
        : { workspaceId: launch.workspaceId, workspaceSessionId: launch.sessionId };
    if (identity) clearAgentChatDraft(identity, { onlyIfLaunchAttemptId: launch.launchAttemptId });
  }
};
