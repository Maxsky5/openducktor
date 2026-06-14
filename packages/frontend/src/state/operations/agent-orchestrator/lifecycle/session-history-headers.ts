import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { MutableRefObject } from "react";
import type { AgentChatMessage, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import { buildSessionHeaderMessages, buildSessionSystemPrompt } from "../support/session-prompt";

export type SessionHistoryHeaderContext = {
  workspaceId: string;
  taskCardsById: ReadonlyMap<string, TaskCard>;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

type SessionHistoryHeaderTarget = Pick<
  AgentSessionState,
  "externalSessionId" | "taskId" | "role" | "startedAt"
>;

const taskCardsById = (tasks: readonly TaskCard[]): ReadonlyMap<string, TaskCard> =>
  new Map(tasks.map((task) => [task.id, task]));

export const buildHistoryHeaderContext = ({
  activeWorkspace,
  taskRef,
  loadRepoPromptOverrides,
}: {
  activeWorkspace: ActiveWorkspace | null;
  taskRef: MutableRefObject<TaskCard[]> | undefined;
  loadRepoPromptOverrides: ((workspaceId: string) => Promise<RepoPromptOverrides>) | undefined;
}): SessionHistoryHeaderContext | undefined => {
  const workspaceId = activeWorkspace?.workspaceId;
  if (!workspaceId || !taskRef || !loadRepoPromptOverrides) {
    return undefined;
  }
  return {
    workspaceId,
    taskCardsById: taskCardsById(taskRef.current),
    loadRepoPromptOverrides,
  };
};

export const buildSessionHistoryHeaders = async ({
  sessions,
  context,
}: {
  sessions: SessionHistoryHeaderTarget[];
  context: SessionHistoryHeaderContext | undefined;
}): Promise<ReadonlyMap<string, AgentChatMessage[]> | undefined> => {
  if (!context || sessions.length === 0) {
    return undefined;
  }

  const promptOverrides = await context.loadRepoPromptOverrides(context.workspaceId);
  const headersBySessionId = new Map<string, AgentChatMessage[]>();
  for (const session of sessions) {
    if (session.role === null) {
      continue;
    }
    const task = context.taskCardsById.get(session.taskId);
    if (!task) {
      throw new Error(
        `Cannot build session header for '${session.externalSessionId}': task '${session.taskId}' is unavailable.`,
      );
    }
    headersBySessionId.set(
      session.externalSessionId,
      buildSessionHeaderMessages({
        externalSessionId: session.externalSessionId,
        systemPrompt: buildSessionSystemPrompt({
          role: session.role,
          task,
          promptOverrides,
        }),
        startedAt: session.startedAt,
      }),
    );
  }
  return headersBySessionId;
};
