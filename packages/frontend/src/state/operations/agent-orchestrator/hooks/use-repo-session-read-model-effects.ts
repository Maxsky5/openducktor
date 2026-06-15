import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionCollection } from "@/state/agent-session-collection";
import type { ActiveWorkspace } from "@/types/state-slices";
import { loadRepoAgentSessionsForTasks } from "../lifecycle/load-sessions";
import { createRepoStaleGuard } from "../support/core";
import type { ObserveAgentSession } from "../support/session-runtime-ref";

type UseRepoSessionReadModelEffectsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  tasks: TaskCard[];
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  readSessionCollection: () => AgentSessionCollection;
  setSessionCollection: (sessionCollection: AgentSessionCollection) => void;
  agentEngine: Pick<AgentEnginePort, "listSessionRuntimeSnapshots">;
  observeAgentSession: ObserveAgentSession;
  setIsLoadingSessionReadModel: Dispatch<SetStateAction<boolean>>;
  setSessionReadModelError: Dispatch<SetStateAction<string | null>>;
  queryClient: QueryClient;
};

export const useRepoSessionReadModelEffects = ({
  activeWorkspace,
  tasks,
  currentWorkspaceRepoPathRef,
  repoEpochRef,
  readSessionCollection,
  setSessionCollection,
  agentEngine,
  observeAgentSession,
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
          setSessionCollection,
          observeAgentSession,
          queryClient,
          isStaleRepoOperation,
          readSessionCollection,
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
    observeAgentSession,
    setSessionCollection,
    currentWorkspaceRepoPathRef,
    repoEpochRef,
    setIsLoadingSessionReadModel,
    setSessionReadModelError,
    readSessionCollection,
    tasks,
    workspaceRepoPath,
    activeWorkspace,
  ]);
};
