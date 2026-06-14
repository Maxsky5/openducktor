import type { AgentModelCatalog, AgentModelSelection } from "@openducktor/core";
import { coerceVisibleSelectionToCatalog } from "@/features/session-start";

export const resolveRoleDefaultSelectionForComposer = ({
  hasSessionTarget,
  composerCatalog,
  isAwaitingRepoSettingsForWorkspaceRepoPath,
  roleDefaultSelection,
}: {
  hasSessionTarget: boolean;
  composerCatalog: AgentModelCatalog | null;
  isAwaitingRepoSettingsForWorkspaceRepoPath: boolean;
  roleDefaultSelection: AgentModelSelection | null;
}): AgentModelSelection | null => {
  if (hasSessionTarget) {
    return roleDefaultSelection;
  }
  if (!composerCatalog) {
    return isAwaitingRepoSettingsForWorkspaceRepoPath ? null : roleDefaultSelection;
  }
  return coerceVisibleSelectionToCatalog(composerCatalog, roleDefaultSelection);
};

export const resolveSelectionCatalogLoading = ({
  hasSessionTarget,
  activeSessionIsLoadingModelCatalog,
  activeSessionModelCatalog,
  composerCatalog,
  isLoadingComposerCatalog,
}: {
  hasSessionTarget: boolean;
  activeSessionIsLoadingModelCatalog: boolean;
  activeSessionModelCatalog: AgentModelCatalog | null;
  composerCatalog: AgentModelCatalog | null;
  isLoadingComposerCatalog: boolean;
}): boolean => {
  if (hasSessionTarget) {
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
