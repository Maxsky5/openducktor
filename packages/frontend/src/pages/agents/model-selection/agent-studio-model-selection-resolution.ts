import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import type { AgentSessionSummary } from "@/state/agent-sessions-store";
import type { AgentSessionState } from "@/types/agent-orchestrator";
import { coerceVisibleSelectionToCatalog } from "../agents-page-selection";

export type ActiveSessionSelectionState = {
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
  hasSelection: boolean;
};

export const resolveActiveSessionSelectionState = (
  activeSession: AgentSessionState | null,
  activeSessionSummary: AgentSessionSummary | null,
): ActiveSessionSelectionState => {
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
    hasSelection: externalSessionId !== null,
  };
};

export const resolveComposerRuntimeKind = ({
  activeSessionSelectedModel,
  draftSelection,
  roleDefaultSelection,
  repoDefaultRuntimeKind,
}: {
  activeSessionSelectedModel: AgentModelSelection | null;
  draftSelection: AgentModelSelection | null;
  roleDefaultSelection: AgentModelSelection | null;
  repoDefaultRuntimeKind?: RuntimeKind | null;
}): RuntimeKind | null => {
  return (
    activeSessionSelectedModel?.runtimeKind ??
    draftSelection?.runtimeKind ??
    roleDefaultSelection?.runtimeKind ??
    repoDefaultRuntimeKind ??
    null
  );
};

export const resolveRoleDefaultSelectionForComposer = ({
  hasActiveSession,
  composerCatalog,
  isAwaitingRepoSettingsForWorkspaceRepoPath,
  roleDefaultSelection,
}: {
  hasActiveSession: boolean;
  composerCatalog: AgentModelCatalog | null;
  isAwaitingRepoSettingsForWorkspaceRepoPath: boolean;
  roleDefaultSelection: AgentModelSelection | null;
}): AgentModelSelection | null => {
  if (hasActiveSession) {
    return roleDefaultSelection;
  }
  if (!composerCatalog) {
    return isAwaitingRepoSettingsForWorkspaceRepoPath ? null : roleDefaultSelection;
  }
  return coerceVisibleSelectionToCatalog(composerCatalog, roleDefaultSelection);
};

export const resolveSelectionCatalogLoading = ({
  hasActiveSession,
  activeSessionIsLoadingModelCatalog,
  activeSessionModelCatalog,
  composerCatalog,
  isLoadingComposerCatalog,
}: {
  hasActiveSession: boolean;
  activeSessionIsLoadingModelCatalog: boolean;
  activeSessionModelCatalog: AgentModelCatalog | null;
  composerCatalog: AgentModelCatalog | null;
  isLoadingComposerCatalog: boolean;
}): boolean => {
  if (hasActiveSession) {
    return activeSessionIsLoadingModelCatalog && !activeSessionModelCatalog && !composerCatalog;
  }
  return isLoadingComposerCatalog;
};

export const resolveSelectedModelSelection = ({
  activeSessionSelectedModel,
  draftSelection,
  roleDefaultSelectionForComposer,
  fallbackCatalogSelection,
}: {
  activeSessionSelectedModel: AgentModelSelection | null;
  draftSelection: AgentModelSelection | null;
  roleDefaultSelectionForComposer: AgentModelSelection | null;
  fallbackCatalogSelection: AgentModelSelection | null;
}): AgentModelSelection | null => {
  return (
    activeSessionSelectedModel ??
    draftSelection ??
    roleDefaultSelectionForComposer ??
    fallbackCatalogSelection ??
    null
  );
};

export const resolveSelectionForNewSession = ({
  draftSelection,
  roleDefaultSelectionForComposer,
  selectionCatalog,
  fallbackCatalogSelection,
}: {
  draftSelection: AgentModelSelection | null;
  roleDefaultSelectionForComposer: AgentModelSelection | null;
  selectionCatalog: AgentModelCatalog | null;
  fallbackCatalogSelection: AgentModelSelection | null;
}): AgentModelSelection | null => {
  return (
    draftSelection ??
    roleDefaultSelectionForComposer ??
    coerceVisibleSelectionToCatalog(selectionCatalog, fallbackCatalogSelection) ??
    fallbackCatalogSelection ??
    null
  );
};

const runtimeSupportsPromptInput = (
  runtimeDefinitions: RuntimeDescriptor[],
  runtimeKind: RuntimeKind | null,
  capability: "supportsSlashCommands" | "supportsFileSearch",
): boolean => {
  if (!runtimeKind) {
    return false;
  }
  return (
    runtimeDefinitions.find((definition) => definition.kind === runtimeKind)?.capabilities
      .promptInput[capability] ?? false
  );
};

export const resolveRuntimePromptInputSupport = ({
  runtimeDefinitions,
  readyActiveSessionRuntimeKind,
  composerRuntimeKind,
}: {
  runtimeDefinitions: RuntimeDescriptor[];
  readyActiveSessionRuntimeKind: RuntimeKind | null;
  composerRuntimeKind: RuntimeKind | null;
}): { runtimeSupportsSlashCommands: boolean; supportsFileSearch: boolean } => {
  const runtimeKind = readyActiveSessionRuntimeKind ?? composerRuntimeKind;
  return {
    runtimeSupportsSlashCommands: runtimeSupportsPromptInput(
      runtimeDefinitions,
      runtimeKind,
      "supportsSlashCommands",
    ),
    supportsFileSearch: runtimeSupportsPromptInput(
      runtimeDefinitions,
      runtimeKind,
      "supportsFileSearch",
    ),
  };
};
