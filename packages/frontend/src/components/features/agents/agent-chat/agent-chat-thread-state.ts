import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { RepoRuntimeReadiness } from "@/lib/use-repo-runtime-readiness";
import {
  type AgentSessionTranscriptState,
  isAgentSessionTranscriptLoading,
  isAgentSessionTranscriptVisible,
} from "@/state/operations/agent-orchestrator/lifecycle/session-view-lifecycle";
import type { AgentChatThreadModel, AgentChatThreadSession } from "./agent-chat.types";

export type AgentChatTranscriptNotice = {
  kind: "runtime_waiting" | "session_loading" | "session_failed" | "runtime_blocked";
  severity: "loading" | "error";
  title: string;
  description: string;
};

export type AgentChatThreadProjection = {
  threadSession: AgentChatThreadSession | null;
  activeSessionKey: string | null;
};

export const deriveAgentChatThreadProjection = ({
  session,
  transcriptState,
}: {
  session: AgentChatThreadSession | null;
  transcriptState: AgentSessionTranscriptState;
}): AgentChatThreadProjection => {
  const threadSession = isAgentSessionTranscriptVisible(transcriptState) ? session : null;

  return {
    threadSession,
    activeSessionKey: threadSession ? agentSessionIdentityKey(threadSession) : null,
  };
};

const deriveAgentChatTranscriptNotice = ({
  transcriptState,
  runtimeReadiness,
}: Pick<
  AgentChatThreadModel,
  "transcriptState" | "runtimeReadiness"
>): AgentChatTranscriptNotice | null => {
  if (
    transcriptState.kind === "runtime_waiting" &&
    runtimeReadiness.readinessState === "blocked" &&
    runtimeReadiness.blockedReason
  ) {
    return {
      kind: "runtime_blocked",
      severity: "error",
      title: "Runtime unavailable",
      description: runtimeReadiness.blockedReason,
    };
  }

  if (transcriptState.kind === "runtime_waiting") {
    return {
      kind: "runtime_waiting",
      severity: "loading",
      title: "Runtime is starting",
      description: "Waiting for runtime and MCP health before loading this session.",
    };
  }

  if (transcriptState.kind === "session_loading") {
    return {
      kind: "session_loading",
      severity: "loading",
      title: "Loading session",
      description:
        transcriptState.reason === "history"
          ? "Loading the selected conversation."
          : "Preparing the selected session view.",
    };
  }

  if (transcriptState.kind === "failed") {
    return {
      kind: "session_failed",
      severity: "error",
      title: "Failed to load session",
      description: "The selected conversation could not be loaded.",
    };
  }

  return null;
};

type BuildAgentChatThreadStateArgs = {
  transcriptState: AgentSessionTranscriptState;
  runtimeReadiness: RepoRuntimeReadiness;
};

export type AgentChatThreadState = {
  shouldResetTranscriptWindow: boolean;
  transcriptNotice: AgentChatTranscriptNotice | null;
};

export const getAgentChatThreadState = ({
  transcriptState,
  runtimeReadiness,
}: BuildAgentChatThreadStateArgs): AgentChatThreadState => {
  const shouldResetTranscriptWindow = isAgentSessionTranscriptLoading(transcriptState);
  const transcriptNotice = deriveAgentChatTranscriptNotice({
    transcriptState,
    runtimeReadiness,
  });

  return {
    shouldResetTranscriptWindow,
    transcriptNotice,
  };
};
