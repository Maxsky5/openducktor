import type { AgentSessionTranscriptState } from "@/state/operations/agent-orchestrator/transcript/session-transcript-state";
import type {
  AgentChatTranscriptNotice,
  AgentChatTranscriptPresentation,
  AgentChatTranscriptSession,
} from "./agent-chat.types";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";

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
    shouldResetWindow: state.kind === "session_loading",
    notice,
  };
};
