import type { AgentModelSelection } from "@openducktor/core";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type ActiveSessionChatComposerSession = Pick<
  AgentSessionState,
  | "externalSessionId"
  | "status"
  | "selectedModel"
  | "runtimeKind"
  | "workingDirectory"
  | "contextUsage"
  | "messages"
>;

export type ActiveSessionChatComposerSummary = Pick<
  AgentSessionSummary,
  "externalSessionId" | "status" | "selectedModel" | "runtimeKind" | "workingDirectory"
>;

export type ActiveSessionChatComposerContext = {
  externalSessionId: string | null;
  status: AgentSessionState["status"] | null;
  selectedModel: AgentModelSelection | null;
  runtimeKind: AgentSessionState["runtimeKind"] | null;
  workingDirectory: string;
  liveContextUsage: AgentSessionState["contextUsage"] | null;
  messages: AgentSessionState["messages"] | null;
  hasActiveSession: boolean;
  hasLoadedActiveSession: boolean;
};

export const resolveActiveSessionChatComposerContext = (
  activeSession: ActiveSessionChatComposerSession | null,
  activeSessionSummary: ActiveSessionChatComposerSummary | null,
): ActiveSessionChatComposerContext => {
  const externalSessionId =
    activeSession?.externalSessionId ?? activeSessionSummary?.externalSessionId ?? null;
  const selectedModel = activeSession?.selectedModel ?? activeSessionSummary?.selectedModel ?? null;

  return {
    externalSessionId,
    status: activeSession?.status ?? activeSessionSummary?.status ?? null,
    selectedModel,
    runtimeKind: activeSession?.runtimeKind ?? activeSessionSummary?.runtimeKind ?? null,
    workingDirectory:
      activeSession?.workingDirectory?.trim() ??
      activeSessionSummary?.workingDirectory?.trim() ??
      "",
    liveContextUsage: activeSession?.contextUsage ?? null,
    messages: activeSession?.messages ?? null,
    hasActiveSession: externalSessionId !== null,
    hasLoadedActiveSession: activeSession !== null,
  };
};
