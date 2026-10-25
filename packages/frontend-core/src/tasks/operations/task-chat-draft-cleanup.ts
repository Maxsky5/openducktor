import type { QueryClient } from "@tanstack/react-query";
import { toAgentChatDraftStorageKey } from "../../drafts/agent-chat-draft-storage";
import { connectionOf } from "../../connection/client-connection";
import type { AgentChatDraftCleanupTarget } from "../../drafts/agent-chat-draft-store";
import { errorMessage } from "../../lib/errors";
import type { ClientFeedback } from "../../platform/client-feedback";
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
  clearDraftsForTargets: (targets: AgentChatDraftCleanupTarget[], queryClient: QueryClient) => void;
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
  feedback,
}: {
  agentSessionReadPort: AgentSessionReadPort;
  draftClearPort: TaskChatDraftClearPort;
  feedback: ClientFeedback;
}): TaskChatDraftCleanup => {
  const reportFailure = (cause: unknown): void => {
    feedback.show("error", "Task updated, but chat draft cleanup failed", {
      description: errorMessage(cause),
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
    let cleanupPreparationError: unknown;
    try {
      cleanupTargets = await prepareTargets(input);
    } catch (cause) {
      cleanupPreparationError = cause;
    }

    const result = await mutation();
    if (!shouldCleanup(result)) {
      return result;
    }
    if (cleanupPreparationError) {
      reportFailure(cleanupPreparationError);
      return result;
    }
    if (cleanupTargets === null || cleanupTargets.targets.length === 0) {
      return result;
    }

    try {
      draftClearPort.clearDraftsForTargets(cleanupTargets.targets, input.queryClient);
    } catch (error) {
      reportFailure(error);
    }
    return result;
  };

  return { prepareTargets, runMutation };
};

export const createProductionTaskChatDraftCleanup = (
  agentSessionReadPort: AgentSessionReadPort,
  feedback: ClientFeedback,
): TaskChatDraftCleanup =>
  createTaskChatDraftCleanup({
    agentSessionReadPort,
    draftClearPort: {
      // Drafts belong to the connection that owns the task reads.
      clearDraftsForTargets: (targets, queryClient) =>
        connectionOf(queryClient).drafts.chat.clearForTargets(targets),
    },
    feedback,
  });

export const prepareTaskChatDraftCleanupTargets = (
  input: TaskChatDraftCleanupInput & { agentSessionReadPort: AgentSessionReadPort },
): Promise<TaskChatDraftCleanupPlan> => {
  const { agentSessionReadPort, ...cleanupInput } = input;
  return createProductionTaskChatDraftCleanup(
    agentSessionReadPort,
    connectionOf(cleanupInput.queryClient).feedback,
  ).prepareTargets(cleanupInput);
};

export const runTaskMutationWithChatDraftCleanup = <TResult>(
  input: RunTaskMutationWithChatDraftCleanupInput<TResult> & {
    agentSessionReadPort: AgentSessionReadPort;
  },
): Promise<TResult> => {
  const { agentSessionReadPort, ...cleanupInput } = input;
  return createProductionTaskChatDraftCleanup(
    agentSessionReadPort,
    connectionOf(cleanupInput.queryClient).feedback,
  ).runMutation(cleanupInput);
};
