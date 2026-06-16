import type { TaskCard } from "@openducktor/contracts";
import type { AgentEnginePort } from "@openducktor/core";
import type { QueryClient } from "@tanstack/react-query";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { useEffect } from "react";
import { errorMessage } from "@/lib/errors";
import type { AgentSessionCollection } from "@/state/agent-session-collection";
import {
  type AgentSessionReadModelLoadState,
  idleAgentSessionReadModelLoadState,
} from "@/types/agent-session-read-model";
import { loadRepoAgentSessionsForTasks } from "../lifecycle/load-sessions";
import { createRepoStaleGuard } from "../support/core";
import type { ObserveAgentSession } from "../support/session-runtime-ref";

type UseRepoSessionReadModelEffectsArgs = {
  workspaceRepoPath: string | null;
  tasks: TaskCard[];
  currentWorkspaceRepoPathRef: MutableRefObject<string | null>;
  repoEpochRef: MutableRefObject<number>;
  readSessionCollection: () => AgentSessionCollection;
  setSessionCollection: (sessionCollection: AgentSessionCollection) => void;
  agentEngine: Pick<AgentEnginePort, "listSessionRuntimeSnapshots">;
  observeAgentSession: ObserveAgentSession;
  setSessionReadModelLoadState: Dispatch<SetStateAction<AgentSessionReadModelLoadState>>;
  queryClient: QueryClient;
};

export const useRepoSessionReadModelEffects = ({
  workspaceRepoPath,
  tasks,
  currentWorkspaceRepoPathRef,
  repoEpochRef,
  readSessionCollection,
  setSessionCollection,
  agentEngine,
  observeAgentSession,
  setSessionReadModelLoadState,
  queryClient,
}: UseRepoSessionReadModelEffectsArgs) => {
  useEffect(() => {
    if (!workspaceRepoPath) {
      setSessionReadModelLoadState(idleAgentSessionReadModelLoadState);
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
      setSessionReadModelLoadState({ kind: "loading" });
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
        if (!isStaleRepoOperation()) {
          setSessionReadModelLoadState(idleAgentSessionReadModelLoadState);
        }
      } catch (error) {
        if (!isStaleRepoOperation()) {
          setSessionReadModelLoadState({
            kind: "failed",
            message: `Failed to load agent session read model for repo '${workspaceRepoPath}': ${errorMessage(
              error,
            )}`,
          });
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
    setSessionReadModelLoadState,
    readSessionCollection,
    tasks,
    workspaceRepoPath,
  ]);
};
