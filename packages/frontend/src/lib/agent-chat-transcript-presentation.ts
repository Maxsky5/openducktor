import type {
  AgentChatTranscriptNotice,
  AgentChatTranscriptPresentation,
  AgentChatTranscriptSession,
} from "@/components/features/agents/agent-chat/agent-chat.types";
import type { AgentSessionTranscriptTarget } from "@/components/features/agents/agent-chat/agent-session-transcript-target";
import {
  type AgentSessionTranscriptState,
  isAgentSessionTranscriptLoading,
} from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";

type ResolveAgentChatTranscriptPresentationArgs = {
  sessionKey: string | null;
  session: AgentChatTranscriptSession | null;
  target: AgentSessionTranscriptTarget | null;
  state: AgentSessionTranscriptState;
  notice: AgentChatTranscriptNotice | null;
};

const shouldHideSession = (state: AgentSessionTranscriptState): boolean =>
  state.kind === "empty" || state.kind === "failed" || state.kind === "session_loading";

export const resolveAgentChatTranscriptPresentation = ({
  sessionKey,
  session,
  target,
  state,
  notice,
}: ResolveAgentChatTranscriptPresentationArgs): AgentChatTranscriptPresentation => {
  if (session && !shouldHideSession(state)) {
    return {
      kind: "session",
      session,
      target,
      displayedSessionKey: sessionKey,
      shouldResetWindow: false,
      notice,
    };
  }

  return {
    kind: "empty",
    session: null,
    target,
    displayedSessionKey: sessionKey,
    shouldResetWindow: isAgentSessionTranscriptLoading(state),
    notice,
  };
};
