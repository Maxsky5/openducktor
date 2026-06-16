import { useEffect } from "react";
import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";

type UseSelectedSessionHistoryLoadArgs = {
  selectedSessionIdentity: AgentSessionIdentity | null;
  transcriptState: AgentSessionTranscriptState;
  loadAgentSessionHistory: (session: AgentSessionIdentity) => Promise<void>;
};

export const shouldLoadSelectedSessionHistory = (
  transcriptState: AgentSessionTranscriptState,
): boolean => transcriptState.kind === "session_loading" && transcriptState.reason === "history";

export const useSelectedSessionHistoryLoad = ({
  selectedSessionIdentity,
  transcriptState,
  loadAgentSessionHistory,
}: UseSelectedSessionHistoryLoadArgs): void => {
  const shouldLoadHistory = shouldLoadSelectedSessionHistory(transcriptState);

  useEffect(() => {
    if (selectedSessionIdentity === null || !shouldLoadHistory) {
      return;
    }

    void loadAgentSessionHistory(selectedSessionIdentity);
  }, [loadAgentSessionHistory, selectedSessionIdentity, shouldLoadHistory]);
};
