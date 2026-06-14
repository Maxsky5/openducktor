import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionCollectionUpdater } from "@/state/agent-session-collection";
import type { ActiveWorkspace } from "@/types/state-slices";
import { loadRepoAgentSessionsForTasks } from "../lifecycle/load-sessions";
import { createRepoStaleGuard } from "../support/core";
import type { ListenToAgentSession } from "../support/session-runtime-ref";

type UseRepoSessionReadModelEffectsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  tasks: TaskCard[];
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  commitSessions: (updater: AgentSessionCollectionUpdater) => void;
  agentEngine: Pick<AgentEnginePort, "listSessionPresence">;
  listenToAgentSession: ListenToAgentSession;
  setIsLoadingSessionReadModel: Dispatch<SetStateAction<boolean>>;
  setSessionReadModelError: Dispatch<SetStateAction<string | null>>;
  queryClient: QueryClient;
};

export const useRepoSessionReadModelEffects = ({
  activeWorkspace,
  tasks,
  currentWorkspaceRepoPathRef,
  repoEpochRef,
  commitSessions,
  agentEngine,
  listenToAgentSession,
  setIsLoadingSessionReadModel,
  setSessionReadModelError,
  queryClient,
}: UseRepoSessionReadModelEffectsArgs) => {
  const workspaceRepoPath = activeWorkspace?.repoPath ?? null;

  useEffect(() => {
    if (!workspaceRepoPath || !activeWorkspace) {
      setIsLoadingSessionReadModel(false);
      setSessionReadModelError(null);
      return;
    }

    let cancelled = false;
    const isRepoStale = createRepoStaleGuard({
      repoPath: workspaceRepoPath,
      repoEpochRef,
      currentWorkspaceRepoPathRef,
    });

    const isStaleRepoOperation = (): boolean => cancelled || isRepoStale();

    const loadSessionReadModel = async (): Promise<void> => {
      if (isStaleRepoOperation()) {
        return;
      }
      setIsLoadingSessionReadModel(true);
      setSessionReadModelError(null);
      try {
        await loadRepoAgentSessionsForTasks({
          repoPath: workspaceRepoPath,
          tasks,
          adapter: agentEngine,
          commitSessions,
          listenToAgentSession,
          queryClient,
          isStaleRepoOperation,
        });
      } catch (error) {
        if (!isStaleRepoOperation()) {
          setSessionReadModelError(
            `Failed to load agent session read model for repo '${workspaceRepoPath}': ${errorMessage(
              error,
            )}`,
          );
        }
      } finally {
        if (!isStaleRepoOperation()) {
          setIsLoadingSessionReadModel(false);
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
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    setIsLoadingSessionReadModel,
    setSessionReadModelError,
    tasks,
    workspaceRepoPath,
    activeWorkspace,
  ]);
};
