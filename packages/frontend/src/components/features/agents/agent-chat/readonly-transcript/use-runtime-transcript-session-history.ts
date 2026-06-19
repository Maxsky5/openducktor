import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { matchesAgentSessionIdentity, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-readiness";
import { useStableAgentSessionIdentity } from "@/lib/use-stable-agent-session-identity";
import { useAgentOperations } from "@/state/app-state-provider";
import { toRuntimeSessionRef } from "@/state/operations/agent-orchestrator/support/session-runtime-ref";
import {
  type AgentSessionTranscriptEmptyReason,
  type AgentSessionTranscriptState,
  emptyAgentSessionTranscriptState,
  failedAgentSessionTranscriptState,
  loadingAgentSessionTranscriptState,
  visibleAgentSessionTranscriptState,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import {
  SESSION_HISTORY_STALE_TIME_MS,
  sessionHistoryQueryOptions,
} from "@/state/queries/agent-session-history";
import { skippedQueryOptions } from "@/state/queries/skipped-query";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";
import type { AgentChatThreadSession } from "../agent-chat.types";
import { toAgentChatThreadSession } from "../agent-chat-thread-session";
import { createReadonlyTranscriptSession } from "./readonly-transcript-session";
import { errorMessageFromUnknown } from "./runtime-transcript-error";

type UseRuntimeTranscriptSessionHistoryArgs = {
  isOpen: boolean;
  repoPath: string | null;
  target: AgentSessionIdentity | null;
  repoReadinessState: RepoRuntimeReadinessState;
  liveSession: AgentSessionState | null;
};

type RuntimeTranscriptSessionHistory = {
  session: AgentChatThreadSession | null;
  transcriptState: AgentSessionTranscriptState;
};

type RuntimeTranscriptSource =
  | { kind: "empty"; reason: AgentSessionTranscriptEmptyReason }
  | { kind: "live"; session: AgentSessionState }
  | { kind: "history"; ref: ReturnType<typeof toRuntimeSessionRef> };

const skippedTranscriptHistoryQueryOptions = skippedQueryOptions<AgentSessionHistoryMessage[]>({
  queryKey: ["runtime-transcript-session-history", "skipped"] as const,
  staleTime: SESSION_HISTORY_STALE_TIME_MS,
  refetchOnWindowFocus: false,
});

export function useRuntimeTranscriptSessionHistory({
  isOpen,
  repoPath,
  target,
  repoReadinessState,
  liveSession,
}: UseRuntimeTranscriptSessionHistoryArgs): RuntimeTranscriptSessionHistory {
  const { readSessionHistory } = useAgentOperations();
  const stableTarget = useStableAgentSessionIdentity(target);
  const source = useMemo<RuntimeTranscriptSource>(() => {
    if (!isOpen || stableTarget === null) {
      return { kind: "empty", reason: "inactive" };
    }
    if (!repoPath) {
      return { kind: "empty", reason: "unavailable" };
    }
    if (liveSession && matchesAgentSessionIdentity(liveSession, stableTarget)) {
      return { kind: "live", session: liveSession };
    }
    return { kind: "history", ref: toRuntimeSessionRef(repoPath, stableTarget) };
  }, [isOpen, liveSession, repoPath, stableTarget]);

  const historyQuery = useQuery(
    source.kind === "history" && repoReadinessState === "ready"
      ? sessionHistoryQueryOptions(source.ref, readSessionHistory)
      : skippedTranscriptHistoryQueryOptions,
  );

  const session = useMemo(() => {
    if (source.kind === "live") {
      return toAgentChatThreadSession(source.session);
    }
    if (source.kind !== "history" || !historyQuery.data) {
      return null;
    }

    return createReadonlyTranscriptSession({
      ...toAgentSessionIdentity(source.ref),
      history: historyQuery.data,
    });
  }, [historyQuery.data, source]);
  const transcriptState = useMemo(() => {
    if (session !== null) {
      return visibleAgentSessionTranscriptState();
    }

    if (source.kind === "empty") {
      return emptyAgentSessionTranscriptState(source.reason);
    }

    if (historyQuery.error && repoReadinessState === "ready") {
      return failedAgentSessionTranscriptState(
        errorMessageFromUnknown(historyQuery.error, "Failed to load transcript history."),
      );
    }

    return loadingAgentSessionTranscriptState({
      reason: "history",
      repoReadinessState,
    });
  }, [historyQuery.error, repoReadinessState, session, source]);

  return {
    session,
    transcriptState,
  };
}
