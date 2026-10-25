import type { AgentSkillReference } from "@openducktor/core";
import type {
  AgentQuestionRequest,
  AgentSessionIdentity,
  SessionMessagesState,
} from "../../types/agent-orchestrator";
import type { AgentSessionActivityState } from "../../types/agent-session-activity";
import type { AgentChatTranscriptNotice } from "../send/agent-chat.types";
import type { AgentSessionTranscriptTarget } from "./agent-session-transcript-target";

export type AgentChatTranscriptSession = AgentSessionIdentity & {
  title?: string;
  activityState: AgentSessionActivityState | null;
  runtimeStatusMessage: string | null;
  messages: SessionMessagesState;
  pendingQuestions: AgentQuestionRequest[];
  skillReferences?: readonly AgentSkillReference[];
};

type AgentChatTranscriptPresentationBase = {
  repoPath: string | null;
  target: AgentSessionTranscriptTarget | null;
  displayedSessionKey: string | null;
  notice: AgentChatTranscriptNotice | null;
};

export type AgentChatTranscriptPresentation = AgentChatTranscriptPresentationBase &
  (
    | {
        kind: "session";
        session: AgentChatTranscriptSession;
        shouldResetWindow: false;
      }
    | {
        kind: "empty";
        session: null;
        shouldResetWindow: boolean;
      }
  );
