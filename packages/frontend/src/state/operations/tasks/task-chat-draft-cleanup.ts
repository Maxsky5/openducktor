import type { QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { toAgentChatDraftStorageKey } from "@/components/features/agents/agent-chat/agent-chat-draft-storage";
import {
  type AgentChatDraftCleanupTarget,
  clearAgentChatDraftsForTargets,
} from "@/components/features/agents/agent-chat/agent-chat-draft-store";
import { errorMessage } from "@/lib/errors";
import {
  type AgentSessionReadPort,
  loadAgentSessionListsFromQuery,
} from "../../queries/agent-sessions";

export type TaskChatDraftCleanupPlan = {
  targets: AgentChatDraftCleanupTarget[];
};

type TaskChatDraftCleanupInput = {
  queryClient: QueryClient;
  repoPath: string;
  workspaceId: string | null;
  taskIds: string[];
  agentSessionReadPort: AgentSessionReadPort;
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
  agentSessionReadPort,
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
      readPort: agentSessionReadPort,
    },
  );
  const targets = new Map<string, AgentChatDraftCleanupTarget>();

  for (const [taskId, sessions] of Object.entries(sessionListsByTaskId)) {
    for (const session of sessions) {
      const target: AgentChatDraftCleanupTarget = {
        workspaceId,
        externalSessionId: session.externalSessionId,
        runtimeKind: session.runtimeKind,
        workingDirectory: session.workingDirectory,
        taskId,
      };
      targets.set(toAgentChatDraftStorageKey(target), target);
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
  agentSessionReadPort,
  mutation,
  shouldCleanup = () => true,
}: RunTaskMutationWithChatDraftCleanupInput<TResult>): Promise<TResult> => {
  let cleanupTargets: TaskChatDraftCleanupPlan | null = null;
  let cleanupTargetLookupError: unknown = null;
  try {
    cleanupTargets = await prepareTaskChatDraftCleanupTargets({
      queryClient,
      repoPath,
      workspaceId,
      taskIds,
      agentSessionReadPort,
    });
  } catch (error) {
    cleanupTargetLookupError = error;
  }

  const result = await mutation();
  if (shouldCleanup(result)) {
    if (cleanupTargetLookupError) {
      reportTaskChatDraftCleanupFailure(cleanupTargetLookupError);
    } else if (cleanupTargets) {
      runTaskChatDraftCleanupAfterSuccess(cleanupTargets);
    }
  }
  return result;
};
