import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { coerceVisibleSelectionToCatalog } from "@/features/session-start";

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
    return (
      !activeSessionModelCatalog &&
      !composerCatalog &&
      (activeSessionIsLoadingModelCatalog || isLoadingComposerCatalog)
    );
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
