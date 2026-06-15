import type { AgentModelSelection } from "@openducktor/core";
import { toAgentSessionIdentity } from "@/lib/agent-session-identity";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionIdentity, AgentSessionState } from "@/types/agent-orchestrator";

export type ActiveSessionChatComposerSession = Pick<
  AgentSessionState,
  "externalSessionId" | "selectedModel" | "runtimeKind" | "workingDirectory"
>;

export type ActiveSessionChatComposerSummary = Pick<
  AgentSessionSummary,
  "externalSessionId" | "selectedModel" | "runtimeKind" | "workingDirectory"
>;

export type ActiveSessionChatComposerTarget =
  | {
      source: "loaded" | "summary";
      sessionIdentity: AgentSessionIdentity;
      selectedModel: AgentModelSelection | null;
    }
  | {
      source: "none";
      sessionIdentity: null;
      selectedModel: null;
    };

export const resolveActiveSessionChatComposerTarget = (
  activeSession: ActiveSessionChatComposerSession | null,
  activeSessionSummary: ActiveSessionChatComposerSummary | null,
): ActiveSessionChatComposerTarget => {
  if (activeSession) {
    return {
      source: "loaded",
      selectedModel: activeSession.selectedModel,
      sessionIdentity: toAgentSessionIdentity(activeSession),
    };
  }

  if (activeSessionSummary) {
    return {
      source: "summary",
      selectedModel: activeSessionSummary.selectedModel,
      sessionIdentity: toAgentSessionIdentity(activeSessionSummary),
    };
  }

  return {
    source: "none",
    selectedModel: null,
    sessionIdentity: null,
  };
};
