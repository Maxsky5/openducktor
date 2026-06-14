import { createContext, use } from "react";
import type { RuntimeSessionTranscriptTarget } from "./readonly-transcript/runtime-session-transcript-target";

export type OpenAgentSessionTranscriptRequest = {
  target: RuntimeSessionTranscriptTarget;
  title?: string;
  description?: string;
};

export type AgentSessionTranscriptDialogContextValue = {
  openSessionTranscript: (request: OpenAgentSessionTranscriptRequest) => void;
  closeSessionTranscript: () => void;
};

export const AgentSessionTranscriptDialogContext =
  createContext<AgentSessionTranscriptDialogContextValue | null>(null);

export const useOptionalAgentSessionTranscriptDialog =
  (): AgentSessionTranscriptDialogContextValue | null => {
    return use(AgentSessionTranscriptDialogContext);
  };

export const useAgentSessionTranscriptDialog = (): AgentSessionTranscriptDialogContextValue => {
  const context = useOptionalAgentSessionTranscriptDialog();
  if (!context) {
    throw new Error(
      "useAgentSessionTranscriptDialog must be used within AgentSessionTranscriptDialogHost.",
    );
  }
  return context;
};
