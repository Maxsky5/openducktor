import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  type AgentChatDraftCleanupTarget,
  clearAgentChatDraftsForTargets,
} from "@/components/features/agents/agent-chat/agent-chat-draft-store";
import { errorMessage } from "@/lib/errors";
import { loadAgentSessionListsFromQuery } from "../../queries/agent-sessions";

export type TaskChatDraftCleanupPlan = {
  targets: AgentChatDraftCleanupTarget[];
  error: Error | null;
};

const toError = (error: unknown): Error =>
  error instanceof Error ? error : new Error(String(error));

export const prepareTaskChatDraftCleanupTargets = async ({
  queryClient,
  repoPath,
  workspaceId,
  taskIds,
}: {
  queryClient: QueryClient;
  repoPath: string;
  workspaceId: string | null;
  taskIds: string[];
}): Promise<TaskChatDraftCleanupPlan> => {
  try {
    if (!workspaceId) {
      throw new Error("Cannot clean chat drafts without an active workspace id.");
    }

    const sessionListsByTaskId = await loadAgentSessionListsFromQuery(
      queryClient,
      repoPath,
      taskIds,
      {
        forceFresh: true,
      },
    );
    const targets = new Map<string, AgentChatDraftCleanupTarget>();

    for (const [taskId, sessions] of Object.entries(sessionListsByTaskId)) {
      for (const session of sessions) {
        targets.set(`${workspaceId}:${session.externalSessionId}`, {
          workspaceId,
          externalSessionId: session.externalSessionId,
          taskId,
        });
      }
    }

    return { targets: Array.from(targets.values()), error: null };
  } catch (error) {
    return { targets: [], error: toError(error) };
  }
};

export const runTaskChatDraftCleanupAfterSuccess = (plan: TaskChatDraftCleanupPlan): boolean => {
  if (plan.error) {
    toast.error("Task updated, but chat draft cleanup failed", {
      description: errorMessage(plan.error),
    });
    return false;
  }

  const { targets } = plan;
  if (targets.length === 0) {
    return true;
  }

  try {
    clearAgentChatDraftsForTargets(targets);
    return true;
  } catch (error) {
    toast.error("Task updated, but chat draft cleanup failed", {
      description: errorMessage(error),
    });
    return false;
  }
};
