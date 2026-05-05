import type { AgentModelSelection } from "@openducktor/core";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";

export type ActiveSessionChatComposerSession = Pick<
  AgentSessionState,
  | "externalSessionId"
  | "repoPath"
  | "status"
  | "selectedModel"
  | "modelCatalog"
  | "runtimeKind"
  | "workingDirectory"
  | "isLoadingModelCatalog"
  | "contextUsage"
  | "messages"
>;

export type ActiveSessionChatComposerSummary = Pick<
  AgentSessionSummary,
  "externalSessionId" | "repoPath" | "status" | "selectedModel" | "runtimeKind" | "workingDirectory"
>;

export type ActiveSessionChatComposerContext = {
  externalSessionId: string | null;
  repoPath: string;
  status: AgentSessionState["status"] | null;
  selectedModel: AgentModelSelection | null;
  modelCatalog: AgentSessionState["modelCatalog"] | null;
  runtimeKind: AgentSessionState["runtimeKind"] | null;
  workingDirectory: string;
  isLoadingModelCatalog: boolean;
  liveContextUsage: AgentSessionState["contextUsage"] | null;
  messages: AgentSessionState["messages"] | null;
  hasActiveSession: boolean;
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
    repoPath: activeSession?.repoPath?.trim() ?? activeSessionSummary?.repoPath?.trim() ?? "",
    status: activeSession?.status ?? activeSessionSummary?.status ?? null,
    selectedModel,
    modelCatalog: activeSession?.modelCatalog ?? null,
    runtimeKind: activeSession?.runtimeKind ?? activeSessionSummary?.runtimeKind ?? null,
    workingDirectory:
      activeSession?.workingDirectory?.trim() ??
      activeSessionSummary?.workingDirectory?.trim() ??
      "",
    isLoadingModelCatalog:
      activeSession?.isLoadingModelCatalog === true ||
      (activeSession == null && activeSessionSummary != null),
    liveContextUsage: activeSession?.contextUsage ?? null,
    messages: activeSession?.messages ?? null,
    hasActiveSession: externalSessionId !== null,
  };
};
