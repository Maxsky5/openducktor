import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentSessionHistorySystemPromptContext } from "@openducktor/core";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { loadSessionPromptContext } from "../support/session-prompt";

export type LoadSessionHistorySystemPromptContext = (
  session: AgentSessionState,
) => Promise<AgentSessionHistorySystemPromptContext | undefined>;

export const createWorkflowSessionHistoryPromptPolicy = ({
  workspaceId,
  taskRef,
  loadRepoPromptOverrides,
}: {
  workspaceId: string | null;
  taskRef: { current: TaskCard[] };
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
}): LoadSessionHistorySystemPromptContext => {
  return async (session): Promise<AgentSessionHistorySystemPromptContext | undefined> => {
    if (session.sessionAssociation.kind === "repository") {
      return undefined;
    }
    if (session.sessionAssociation.kind === "unbound") {
      throw new Error(
        `Cannot load history for unbound session '${session.externalSessionId}'; repository or workflow context is required.`,
      );
    }
    if (!workspaceId) {
      throw new Error("Cannot load workflow session history without an active workspace.");
    }

    const { taskId, role } = session.sessionAssociation;
    const task = taskRef.current.find((entry) => entry.id === taskId);
    if (!task) {
      throw new Error(
        `Cannot load history for '${session.externalSessionId}': task '${taskId}' is unavailable.`,
      );
    }

    const { systemPrompt } = await loadSessionPromptContext({
      workspaceId,
      role,
      task,
      loadRepoPromptOverrides,
    });
    return { systemPrompt, startedAt: session.startedAt };
  };
};
