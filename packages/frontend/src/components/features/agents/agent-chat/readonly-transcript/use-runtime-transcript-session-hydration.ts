import type { AgentSessionHistoryMessage } from "@openducktor/core";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { createRuntimeTranscriptSession } from "@/state/operations/agent-orchestrator/support/runtime-transcript-session";
import { sessionHistoryQueryOptions } from "@/state/queries/agent-session-runtime";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import type { ActiveWorkspace } from "@/types/state-slices";
import type { RuntimeSessionTranscriptSource } from "./runtime-session-transcript-source";
import { errorMessageFromUnknown } from "./runtime-transcript-error";
import type { RuntimeTranscriptSourceResolution } from "./use-runtime-transcript-source-resolution";

type ReadSessionHistory = (
  repoPath: string,
  runtimeKind: NonNullable<AgentSessionState["runtimeKind"]>,
  workingDirectory: string,
  externalSessionId: string,
) => Promise<AgentSessionHistoryMessage[]>;

type UseRuntimeTranscriptSessionHydrationArgs = {
  isOpen: boolean;
  activeWorkspace: ActiveWorkspace | null;
  externalSessionId: string | null;
  source: RuntimeSessionTranscriptSource | null;
  sourceResolution: RuntimeTranscriptSourceResolution;
  liveSession: AgentSessionState | null;
  readSessionHistory: ReadSessionHistory;
};

type RuntimeTranscriptSessionHydration = {
  session: AgentSessionState | null;
  isHistoryLoading: boolean;
  historyError: string | null;
};

export function useRuntimeTranscriptSessionHydration({
  isOpen,
  activeWorkspace,
  externalSessionId,
  source,
  sourceResolution,
  liveSession,
  readSessionHistory,
}: UseRuntimeTranscriptSessionHydrationArgs): RuntimeTranscriptSessionHydration {
  const historyQueryEnabled = Boolean(
    isOpen &&
      activeWorkspace &&
      externalSessionId &&
      source &&
      !sourceResolution.error &&
      !sourceResolution.isPending &&
      liveSession === null,
  );

  const historyQuery = useQuery({
    ...(source && activeWorkspace && externalSessionId
      ? sessionHistoryQueryOptions(
          activeWorkspace.repoPath,
          source.runtimeKind,
          source.workingDirectory,
          externalSessionId,
          readSessionHistory,
        )
      : sessionHistoryQueryOptions(
          activeWorkspace?.repoPath ?? "",
          DEFAULT_RUNTIME_KIND,
          source?.workingDirectory ?? "",
          externalSessionId ?? "disabled",
          readSessionHistory,
        )),
    enabled: historyQueryEnabled,
  });

  const session = useMemo(() => {
    if (liveSession) {
      return liveSession;
    }
    if (!activeWorkspace || !source || !externalSessionId || !historyQuery.data) {
      return null;
    }

    return createRuntimeTranscriptSession({
      repoPath: activeWorkspace.repoPath,
      externalSessionId,
      runtimeKind: source.runtimeKind,
      runtimeId: sourceResolution.runtimeId,
      workingDirectory: source.workingDirectory,
      history: historyQuery.data,
      isLive: source.isLive === true,
      pendingApprovals: [],
      pendingQuestions: [],
    });
  }, [
    activeWorkspace,
    externalSessionId,
    historyQuery.data,
    liveSession,
    source,
    sourceResolution.runtimeId,
  ]);

  return {
    session,
    isHistoryLoading: historyQueryEnabled && historyQuery.isPending,
    historyError: historyQuery.error
      ? errorMessageFromUnknown(historyQuery.error, "Failed to load transcript history.")
      : null,
  };
}
