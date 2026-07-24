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
};

export type RunTaskMutationWithChatDraftCleanupInput<TResult> = TaskChatDraftCleanupInput & {
  mutation: () => Promise<TResult>;
  shouldCleanup?: (result: TResult) => boolean;
};

export type TaskChatDraftClearPort = {
  clearDraftsForTargets: (targets: AgentChatDraftCleanupTarget[]) => void;
};

export type TaskChatDraftCleanupNotificationPort = {
  error: (title: string, options: { description: string }) => unknown;
};

export type TaskChatDraftCleanup = {
  prepareTargets: (input: TaskChatDraftCleanupInput) => Promise<TaskChatDraftCleanupPlan>;
  runMutation: <TResult>(
    input: RunTaskMutationWithChatDraftCleanupInput<TResult>,
  ) => Promise<TResult>;
};

export const createTaskChatDraftCleanup = ({
  agentSessionReadPort,
  draftClearPort,
  notificationPort,
}: {
  agentSessionReadPort: AgentSessionReadPort;
  draftClearPort: TaskChatDraftClearPort;
  notificationPort: TaskChatDraftCleanupNotificationPort;
}): TaskChatDraftCleanup => {
  const reportFailure = (error: unknown): void => {
    notificationPort.error("Task updated, but chat draft cleanup failed", {
      description: errorMessage(error),
    });
  };

  const prepareTargets = async ({
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
      { forceFresh: true, readPort: agentSessionReadPort },
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

  const runMutation = async <TResult>({
    mutation,
    shouldCleanup = () => true,
    ...input
  }: RunTaskMutationWithChatDraftCleanupInput<TResult>): Promise<TResult> => {
    let cleanupTargets: TaskChatDraftCleanupPlan | null = null;
    let cleanupTargetLookupError: unknown = null;
    try {
      cleanupTargets = await prepareTargets(input);
    } catch (error) {
      cleanupTargetLookupError = error;
    }

    const result = await mutation();
    if (!shouldCleanup(result)) {
      return result;
    }
    if (cleanupTargetLookupError) {
      reportFailure(cleanupTargetLookupError);
      return result;
    }
    if (!cleanupTargets || cleanupTargets.targets.length === 0) {
      return result;
    }

    try {
      draftClearPort.clearDraftsForTargets(cleanupTargets.targets);
    } catch (error) {
      reportFailure(error);
    }
    return result;
  };

  return { prepareTargets, runMutation };
};

export const createProductionTaskChatDraftCleanup = (
  agentSessionReadPort: AgentSessionReadPort,
): TaskChatDraftCleanup =>
  createTaskChatDraftCleanup({
    agentSessionReadPort,
    draftClearPort: { clearDraftsForTargets: clearAgentChatDraftsForTargets },
    notificationPort: toast,
  });

export const prepareTaskChatDraftCleanupTargets = (
  input: TaskChatDraftCleanupInput & { agentSessionReadPort: AgentSessionReadPort },
): Promise<TaskChatDraftCleanupPlan> => {
  const { agentSessionReadPort, ...cleanupInput } = input;
  return createProductionTaskChatDraftCleanup(agentSessionReadPort).prepareTargets(cleanupInput);
};

export const runTaskMutationWithChatDraftCleanup = <TResult>(
  input: RunTaskMutationWithChatDraftCleanupInput<TResult> & {
    agentSessionReadPort: AgentSessionReadPort;
  },
): Promise<TResult> => {
  const { agentSessionReadPort, ...cleanupInput } = input;
  return createProductionTaskChatDraftCleanup(agentSessionReadPort).runMutation(cleanupInput);
};
