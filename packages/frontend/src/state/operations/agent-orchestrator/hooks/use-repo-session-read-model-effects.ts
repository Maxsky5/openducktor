import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { loadRepoAgentSessions } from "../lifecycle/load-sessions";
import { loadTaskSessionRecordsForTasks } from "../session-read-model/task-session-records";
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
  agentEngine: Pick<AgentEnginePort, "listSessionPresence" | "loadSessionHistory">;
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
        const taskSessionRecords = await loadTaskSessionRecordsForTasks({
          queryClient,
          repoPath: workspaceRepoPath,
          tasks,
        });
        if (!isCurrentRepo()) {
          return;
        }
        await loadRepoAgentSessions({
          repoPath: workspaceRepoPath,
          tasks: taskSessionRecords,
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
