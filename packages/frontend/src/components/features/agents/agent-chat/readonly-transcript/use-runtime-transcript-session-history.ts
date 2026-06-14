import type { AgentSessionHistoryMessage, LoadAgentSessionHistoryInput } from "@openducktor/core";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import {
  type AgentSessionHistoryLoadState,
  type AgentSessionViewLifecycle,
  deriveAgentSessionTargetViewLifecycle,
  type SessionRepoReadinessState,
} from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import { getSessionMessageCount } from "@/state/operations/agent-orchestrator/support/messages";
import {
  agentSessionRuntimeQueryKeys,
  SESSION_HISTORY_STALE_TIME_MS,
} from "@/state/queries/agent-session-runtime";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { AgentChatThreadSession } from "../agent-chat.types";
import { toAgentChatThreadSession } from "../agent-chat-thread-session";
import { createReadonlyTranscriptSession } from "./readonly-transcript-session";
import { errorMessageFromUnknown } from "./runtime-transcript-error";

type ReadSessionHistory = (
  session: LoadAgentSessionHistoryInput,
) => Promise<AgentSessionHistoryMessage[]>;

type UseRuntimeTranscriptSessionHistoryArgs = {
  isOpen: boolean;
  activeWorkspace: ActiveWorkspace | null;
  target: AgentSessionIdentity | null;
  repoReadinessState: SessionRepoReadinessState;
  liveSession: AgentSessionState | null;
  readSessionHistory: ReadSessionHistory;
};

type RuntimeTranscriptSessionHistory = {
  session: AgentChatThreadSession | null;
  lifecycle: AgentSessionViewLifecycle;
  historyError: string | null;
};

export function useRuntimeTranscriptSessionHistory({
  isOpen,
  activeWorkspace,
  target,
  repoReadinessState,
  liveSession,
  readSessionHistory,
}: UseRuntimeTranscriptSessionHistoryArgs): RuntimeTranscriptSessionHistory {
  const targetLiveSession = matchesAgentSessionIdentity(liveSession, target) ? liveSession : null;
  const canLoadRuntimeHistory = repoReadinessState === "ready";
  const historyQueryEnabled = Boolean(
    isOpen && activeWorkspace && target && targetLiveSession === null && canLoadRuntimeHistory,
  );
  const historyQueryInput =
    target && activeWorkspace
      ? {
          repoPath: activeWorkspace.repoPath,
          runtimeKind: target.runtimeKind,
          workingDirectory: target.workingDirectory,
          externalSessionId: target.externalSessionId,
        }
      : null;

  const historyQuery = useQuery({
    queryKey: historyQueryInput
      ? agentSessionRuntimeQueryKeys.history(historyQueryInput)
      : agentSessionRuntimeQueryKeys.historyUnavailable(),
    queryFn: historyQueryInput
      ? (): Promise<AgentSessionHistoryMessage[]> => readSessionHistory(historyQueryInput)
      : skipToken,
    enabled: historyQueryEnabled,
    staleTime: SESSION_HISTORY_STALE_TIME_MS,
    refetchOnWindowFocus: false,
  });

  const session = useMemo(() => {
    if (targetLiveSession) {
      return toAgentChatThreadSession(targetLiveSession, []);
    }
    if (!activeWorkspace || !target || !historyQuery.data) {
      return null;
    }

    return createReadonlyTranscriptSession({
      externalSessionId: target.externalSessionId,
      runtimeKind: target.runtimeKind,
      workingDirectory: target.workingDirectory,
      history: historyQuery.data,
    });
  }, [activeWorkspace, historyQuery.data, targetLiveSession, target]);
  const historyLoadState: AgentSessionHistoryLoadState | null = (() => {
    if (targetLiveSession || session) {
      return "loaded";
    }
    if (!isOpen || !activeWorkspace || !target) {
      return null;
    }
    if (historyQuery.error) {
      return "failed";
    }
    if (historyQuery.isPending) {
      return "loading";
    }
    return "not_requested";
  })();
  const lifecycle = useMemo(
    () =>
      deriveAgentSessionTargetViewLifecycle({
        target:
          target && historyLoadState
            ? {
                historyLoadState,
                hasTranscript: session ? getSessionMessageCount(session) > 0 : false,
              }
            : null,
        repoReadinessState,
      }),
    [historyLoadState, repoReadinessState, session, target],
  );

  return {
    session,
    lifecycle,
    historyError: historyQuery.error
      ? errorMessageFromUnknown(historyQuery.error, "Failed to load transcript history.")
      : null,
  };
}
