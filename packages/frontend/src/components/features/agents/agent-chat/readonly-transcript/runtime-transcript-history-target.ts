import type { AgentSessionRef } from "@openducktor/core";
import { matchesAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadinessState } from "@/lib/repo-runtime-health";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";

export type RuntimeTranscriptHistoryTarget =
  | { kind: "none" }
  | { kind: "live"; session: AgentSessionState }
  | { kind: "history"; sessionRef: AgentSessionRef; canReadHistory: boolean };

type ResolveRuntimeTranscriptHistoryTargetArgs = {
  isOpen: boolean;
  repoPath: string | null;
  target: AgentSessionIdentity | null;
  repoReadinessState: RepoRuntimeReadinessState;
  liveSession: AgentSessionState | null;
};

export const resolveRuntimeTranscriptHistoryTarget = ({
  isOpen,
  repoPath,
  target,
  repoReadinessState,
  liveSession,
}: ResolveRuntimeTranscriptHistoryTargetArgs): RuntimeTranscriptHistoryTarget => {
  if (!isOpen || !target) {
    return { kind: "none" };
  }

  const matchedLiveSession = matchesAgentSessionIdentity(liveSession, target) ? liveSession : null;
  if (matchedLiveSession) {
    return { kind: "live", session: matchedLiveSession };
  }

  if (!repoPath) {
    return { kind: "none" };
  }

  return {
    kind: "history",
    sessionRef: {
      repoPath,
      runtimeKind: target.runtimeKind,
      workingDirectory: target.workingDirectory,
      externalSessionId: target.externalSessionId,
    },
    canReadHistory: repoReadinessState === "ready",
  };
};
