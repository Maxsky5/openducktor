import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, SetStateAction } from "react";
import { useEffect } from "react";
import { errorMessage } from "@/lib/errors";
import type {
  AgentSessionCollection,
  AgentSessionCollectionUpdater,
} from "@/state/agent-session-collection";
import type { ActiveWorkspace } from "@/types/state-slices";
import { loadRepoAgentSessions } from "../lifecycle/load-sessions";
import { buildHistoryRuntimeContext } from "../lifecycle/session-history-runtime-context";
import { loadTaskSessionRecordsForTasks } from "../session-read-model/task-session-records";
import type { ListenToAgentSession } from "../support/session-runtime-ref";
import type { UpdateAgentSession } from "./use-agent-session-mutations";

type UseRepoSessionReadModelEffectsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  tasks: TaskCard[];
  currentWorkspaceRepoPathRef: { current: string | null };
  sessionsRef: { readonly current: AgentSessionCollection };
  commitSessions: (updater: AgentSessionCollectionUpdater) => void;
  updateSession: UpdateAgentSession;
  agentEngine: Pick<AgentEnginePort, "listSessionPresence" | "loadSessionHistory">;
  listenToAgentSession?: ListenToAgentSession;
  setSessionReadModelError: Dispatch<SetStateAction<string | null>>;
  queryClient: QueryClient;
  loadRepoPromptOverrides: (workspaceId: string) => Promise<RepoPromptOverrides>;
};

export const useRepoSessionReadModelEffects = ({
  activeWorkspace,
  tasks,
  currentWorkspaceRepoPathRef,
  sessionsRef,
  commitSessions,
  updateSession,
  agentEngine,
  listenToAgentSession,
  setSessionReadModelError,
  queryClient,
  loadRepoPromptOverrides,
}: UseRepoSessionReadModelEffectsArgs) => {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;

  useEffect(() => {
    if (!workspaceRepoPath || !activeWorkspace) {
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
        const historyRuntimeContext = buildHistoryRuntimeContext({
          activeWorkspace,
          tasks,
          loadRepoPromptOverrides,
        });
        await loadRepoAgentSessions({
          repoPath: workspaceRepoPath,
          tasks: taskSessionRecords,
          adapter: agentEngine,
          commitSessions,
          updateSession,
          ...(listenToAgentSession ? { listenToAgentSession } : {}),
          sessionsRef,
          historyRuntimeContext,
          isStaleRepoOperation: () => !isCurrentRepo(),
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
    sessionsRef,
    setSessionReadModelError,
    tasks,
    workspaceRepoPath,
    activeWorkspace,
    loadRepoPromptOverrides,
  ]);
};
