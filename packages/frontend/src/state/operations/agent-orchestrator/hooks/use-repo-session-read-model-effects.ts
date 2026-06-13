import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import { errorMessage } from "@/lib/errors";
import { loadAgentSessionListsFromQuery } from "@/state/queries/agent-sessions";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { loadRepoAgentSessions } from "../lifecycle/load-sessions";
import type { ListenToAgentSession } from "../support/session-runtime-ref";
import type { UpdateAgentSession } from "./use-agent-session-mutations";

type UseRepoSessionReadModelEffectsArgs = {
  workspaceRepoPath: string | null;
  tasks: TaskCard[];
  currentWorkspaceRepoPathRef: { current: string | null };
  commitSessions: (
    updater:
      | Record<string, AgentSessionState>
      | ((current: Record<string, AgentSessionState>) => Record<string, AgentSessionState>),
  ) => void;
  updateSession: UpdateAgentSession;
  agentEngine: Pick<
    AgentEnginePort,
    "restoreSession" | "listSessionPresence" | "loadSessionHistory"
  >;
  listenToAgentSession?: ListenToAgentSession;
  setSessionReadModelError: Dispatch<SetStateAction<string | null>>;
  queryClient: QueryClient;
};

export const useRepoSessionReadModelEffects = ({
  workspaceRepoPath,
  tasks,
  currentWorkspaceRepoPathRef,
  commitSessions,
  updateSession,
  agentEngine,
  listenToAgentSession,
  setSessionReadModelError,
  queryClient,
}: UseRepoSessionReadModelEffectsArgs) => {
  useEffect(() => {
    if (!workspaceRepoPath) {
      setSessionReadModelError(null);
      return;
    }

    let cancelled = false;

    const isCurrentRepo = (): boolean =>
      !cancelled && currentWorkspaceRepoPathRef.current === workspaceRepoPath;

    const loadSessionReadModel = async (): Promise<void> => {
      if (!isCurrentRepo()) {
        return;
      }
      setSessionReadModelError(null);
      try {
        const taskIds = tasks.map((task) => task.id);
        const recordsByTaskId =
          taskIds.length > 0
            ? await loadAgentSessionListsFromQuery(queryClient, workspaceRepoPath, taskIds)
            : {};
        if (!isCurrentRepo()) {
          return;
        }
        await loadRepoAgentSessions({
          repoPath: workspaceRepoPath,
          tasks: tasks.map((task) => ({
            id: task.id,
            agentSessions: recordsByTaskId[task.id] ?? [],
          })),
          adapter: agentEngine,
          commitSessions,
          updateSession,
          ...(listenToAgentSession ? { listenToAgentSession } : {}),
          isStaleRepoOperation: () => !isCurrentRepo(),
          options: { historyPolicy: "live_if_empty" },
        });
      } catch (error) {
        if (isCurrentRepo()) {
          setSessionReadModelError(
            `Failed to load agent session read model for repo '${workspaceRepoPath}': ${errorMessage(
              error,
            )}`,
          );
        }
      }
    };

    void loadSessionReadModel();

    return () => {
      cancelled = true;
    };
  }, [
    agentEngine,
    queryClient,
    listenToAgentSession,
    commitSessions,
    updateSession,
    currentWorkspaceRepoPathRef,
    setSessionReadModelError,
    tasks,
    workspaceRepoPath,
  ]);
};
