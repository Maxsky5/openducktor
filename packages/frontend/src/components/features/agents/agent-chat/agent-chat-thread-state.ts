import {
  type AgentSessionTranscriptState,
  isAgentSessionTranscriptLoading,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type { AgentChatThreadSession, AgentChatTranscriptNotice } from "./agent-chat.types";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";

export type AgentChatThreadState = {
  threadSession: AgentChatThreadSession | null;
  transcriptTarget: AgentSessionTranscriptTarget | null;
  displayedSessionKey: string | null;
  shouldResetTranscriptWindow: boolean;
  transcriptNotice: AgentChatTranscriptNotice | null;
};

type ProjectAgentChatThreadStateArgs = {
  sessionKey: string | null;
  session: AgentChatThreadSession | null;
  transcriptTarget: AgentSessionTranscriptTarget | null;
  transcriptState: AgentSessionTranscriptState;
  transcriptNotice: AgentChatTranscriptNotice | null;
};

const hidesExistingSessionTranscript = (transcriptState: AgentSessionTranscriptState): boolean =>
  transcriptState.kind === "empty" ||
  transcriptState.kind === "failed" ||
  transcriptState.kind === "session_loading";

export const projectAgentChatThreadState = ({
  sessionKey,
  session,
  transcriptTarget,
  transcriptState,
  transcriptNotice,
}: ProjectAgentChatThreadStateArgs): AgentChatThreadState => {
  const threadSession = hidesExistingSessionTranscript(transcriptState) ? null : session;
  const shouldResetTranscriptWindow =
    isAgentSessionTranscriptLoading(transcriptState) && threadSession === null;

  return {
    threadSession,
    transcriptTarget,
    displayedSessionKey: sessionKey,
    shouldResetTranscriptWindow,
    transcriptNotice,
  };
};
