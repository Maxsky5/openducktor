import type { AgentMessageQueueAction } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import { HostInvokeError } from "@openducktor/host-client";
import { errorMessage } from "../../../lib/errors";
import { getAcceptedMessageAfterSendFailure } from "../../agent-runtime-services";
import type { AgentMessageQueuesStore } from "../../agent-message-queues-store";
import type { AgentSessionIdentity } from "../../../types/agent-orchestrator";
import type { UpdateSession } from "../events/session-event-types";
import {
  type ReadSessionSnapshot,
  requireLoadedSession,
  requireWorkspaceRepoPath,
} from "../support/session-invariants";
import { toBoundRuntimeSessionRef } from "../support/session-runtime-ref";
import {
  appendSendFailureNotice,
  type SendAgentMessageDependencies,
  upsertAcceptedUserMessage,
} from "./send-agent-message";

type MessageQueueActionDependencies = Pick<
  SendAgentMessageDependencies,
  "currentWorkspaceRepoPathRef" | "repoEpochRef" | "workspaceRepoPath"
> & {
  adapter: Pick<AgentEnginePort, "manageMessageQueue">;
  messageQueues: Pick<AgentMessageQueuesStore, "apply">;
  readSessionSnapshot: ReadSessionSnapshot;
  updateSession: UpdateSession;
};

export const createManageAgentMessageQueue =
  (dependencies: MessageQueueActionDependencies) =>
  async (identity: AgentSessionIdentity, action: AgentMessageQueueAction): Promise<void> => {
    const session = requireLoadedSession(dependencies.readSessionSnapshot, identity);
    const repoPath = requireWorkspaceRepoPath(dependencies.workspaceRepoPath);
    const target = toBoundRuntimeSessionRef(repoPath, session, "manage queued messages");
    try {
      const result = await dependencies.adapter.manageMessageQueue({ ...target, action });
      dependencies.messageQueues.apply(result.queue);
      if (result.acceptedMessage) {
        upsertAcceptedUserMessage(
          session,
          result.acceptedMessage,
          undefined,
          dependencies.updateSession,
        );
      }
    } catch (error) {
      const acceptedMessage =
        error instanceof HostInvokeError ? getAcceptedMessageAfterSendFailure(error, target) : null;
      if (!acceptedMessage) throw error;
      // The agent received the message, so it shows once and the later failure becomes a notice.
      upsertAcceptedUserMessage(session, acceptedMessage, undefined, dependencies.updateSession);
      appendSendFailureNotice(session, errorMessage(error), dependencies.updateSession, false);
    }
  };
