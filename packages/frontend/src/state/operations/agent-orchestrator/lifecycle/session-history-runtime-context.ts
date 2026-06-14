import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { buildSessionSystemPrompt } from "../support/session-prompt";
import type { AgentSessionHistoryTarget } from "./session-history-loader";

export type SessionHistoryRuntimeContext = {
  workspaceId: string;
  taskCardsById: ReadonlyMap<string, TaskCard>;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

type SessionHistoryRuntimeContextTarget = Pick<
  AgentSessionState,
  "externalSessionId" | "taskId" | "role" | "startedAt"
>;

const taskCardsById = (tasks: readonly TaskCard[]): ReadonlyMap<string, TaskCard> =>
  new Map(tasks.map((task) => [task.id, task]));

export const buildHistoryRuntimeContext = ({
  activeWorkspace,
  tasks,
  loadRepoPromptOverrides,
}: {
  activeWorkspace: ActiveWorkspace;
  tasks: readonly TaskCard[];
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
}): SessionHistoryRuntimeContext => {
  return {
    workspaceId: activeWorkspace.workspaceId,
    taskCardsById: taskCardsById(tasks),
    loadRepoPromptOverrides,
  };
};

export const withSessionHistoryRuntimeContext = async <
  Session extends AgentSessionHistoryTarget & SessionHistoryRuntimeContextTarget,
>({
  sessions,
  context,
}: {
  sessions: readonly Session[];
  context: SessionHistoryRuntimeContext;
}): Promise<Session[]> => {
  if (sessions.length === 0) {
    return [...sessions];
  }

  const promptOverrides = await context.loadRepoPromptOverrides(context.workspaceId);
  return sessions.map((session) => {
    if (session.role === null) {
      return session;
    }
    const task = context.taskCardsById.get(session.taskId);
    if (!task) {
      throw new Error(
        `Cannot load history for '${session.externalSessionId}': task '${session.taskId}' is unavailable.`,
      );
    }
    return {
      ...session,
      systemPromptContext: {
        systemPrompt: buildSessionSystemPrompt({
          role: session.role,
          task,
          promptOverrides,
        }),
        startedAt: session.startedAt,
      },
    };
  });
};
