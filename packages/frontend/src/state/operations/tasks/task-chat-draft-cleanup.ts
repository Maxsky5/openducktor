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
};

type TaskChatDraftCleanupInput = {
  queryClient: QueryClient;
  repoPath: string;
  workspaceId: string | null;
  taskIds: string[];
};

type RunTaskMutationWithChatDraftCleanupInput<TResult> = TaskChatDraftCleanupInput & {
  mutation: () => Promise<TResult>;
  shouldCleanup?: (result: TResult) => boolean;
};

const reportTaskChatDraftCleanupFailure = (error: unknown): void => {
  toast.error("Task updated, but chat draft cleanup failed", {
    description: errorMessage(error),
  });
};

export const prepareTaskChatDraftCleanupTargets = async ({
  queryClient,
  repoPath,
  workspaceId,
  taskIds,
}: TaskChatDraftCleanupInput): Promise<TaskChatDraftCleanupPlan> => {
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

  return { targets: Array.from(targets.values()) };
};

export const runTaskChatDraftCleanupAfterSuccess = (plan: TaskChatDraftCleanupPlan): boolean => {
  const { targets } = plan;
  if (targets.length === 0) {
    return true;
  }

  try {
    clearAgentChatDraftsForTargets(targets);
    return true;
  } catch (error) {
    reportTaskChatDraftCleanupFailure(error);
    return false;
  }
};

export const runTaskMutationWithChatDraftCleanup = async <TResult>({
  queryClient,
  repoPath,
  workspaceId,
  taskIds,
  mutation,
  shouldCleanup = () => true,
}: RunTaskMutationWithChatDraftCleanupInput<TResult>): Promise<TResult> => {
  const cleanupTargets = await prepareTaskChatDraftCleanupTargets({
    queryClient,
    repoPath,
    workspaceId,
    taskIds,
  });
  const result = await mutation();
  if (shouldCleanup(result)) {
    runTaskChatDraftCleanupAfterSuccess(cleanupTargets);
  }
  return result;
};
