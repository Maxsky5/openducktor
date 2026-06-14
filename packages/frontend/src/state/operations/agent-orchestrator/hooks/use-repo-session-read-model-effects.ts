import type { RepoPromptOverrides, TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { errorMessage } from "@/lib/errors";
import type {
  AgentSessionCollection,
  AgentSessionCollectionUpdater,
} from "@/state/agent-session-collection";
import type { ActiveWorkspace } from "@/types/state-slices";
import { loadRepoAgentSessionsForTasks } from "../lifecycle/load-sessions";
import { createRepoStaleGuard } from "../support/core";
import type { ListenToAgentSession } from "../support/session-runtime-ref";
import type { UpdateAgentSession } from "./use-agent-session-mutations";

type UseRepoSessionReadModelEffectsArgs = {
  activeWorkspace: ActiveWorkspace | null;
  tasks: TaskCard[];
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
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
  repoEpochRef,
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
      setSessionReadModelError(null);
      try {
        await loadRepoAgentSessionsForTasks({
          activeWorkspace,
          repoPath: workspaceRepoPath,
          tasks,
          adapter: agentEngine,
          commitSessions,
          updateSession,
          ...(listenToAgentSession ? { listenToAgentSession } : {}),
          sessionsRef,
          queryClient,
          loadRepoPromptOverrides,
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
    repoEpochRef,
    sessionsRef,
    setSessionReadModelError,
    tasks,
    workspaceRepoPath,
    activeWorkspace,
    loadRepoPromptOverrides,
  ]);
};
