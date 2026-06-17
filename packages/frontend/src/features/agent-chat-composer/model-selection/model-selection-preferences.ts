import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import {
  coerceVisibleSelectionToCatalog,
  pickDefaultVisibleSelectionForCatalog,
} from "@/features/session-start";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import type { RepoSettingsInput } from "@/types/state-slices";

export const toRoleDefaultModelSelection = (
  roleDefault: RepoSettingsInput["agentDefaults"][AgentRole] | null | undefined,
  repoDefaultRuntimeKind?: RepoSettingsInput["defaultRuntimeKind"] | null,
): AgentModelSelection | null => {
  if (!roleDefault?.providerId || !roleDefault.modelId) {
    return null;
  }
  const runtimeKind = roleDefault.runtimeKind ?? repoDefaultRuntimeKind;
  if (!runtimeKind) {
    return null;
  }
  return {
    runtimeKind,
    providerId: roleDefault.providerId,
    modelId: roleDefault.modelId,
    ...(roleDefault.variant ? { variant: roleDefault.variant } : {}),
    ...(roleDefault.profileId ? { profileId: roleDefault.profileId } : {}),
  };
};

export const resolveAvailableRoleDefaultModelSelection = ({
  repoSettings,
  role,
  runtimeDefinitions,
}: {
  repoSettings: RepoSettingsInput | null;
  role: AgentRole;
  runtimeDefinitions: RuntimeDescriptor[];
}): AgentModelSelection | null => {
  const selection = toRoleDefaultModelSelection(
    repoSettings?.agentDefaults[role],
    repoSettings?.defaultRuntimeKind,
  );
  if (!selection) {
    return null;
  }
  const runtimeKind = selection.runtimeKind;
  if (!runtimeKind) {
    return null;
  }
  return findRuntimeDefinition(runtimeDefinitions, runtimeKind) ? selection : null;
};

export const resolveChatComposerSelectedRuntimeKind = ({
  selectedSessionModel,
  draftSelection,
  roleDefaultSelection,
  repoDefaultRuntimeKind,
  runtimeDefinitions,
}: {
  selectedSessionModel: AgentModelSelection | null;
  draftSelection: AgentModelSelection | null;
  roleDefaultSelection: AgentModelSelection | null;
  repoDefaultRuntimeKind: RuntimeKind | null | undefined;
  runtimeDefinitions: RuntimeDescriptor[];
}): RuntimeKind | null => {
  const availableRepoDefaultRuntimeKind =
    repoDefaultRuntimeKind && findRuntimeDefinition(runtimeDefinitions, repoDefaultRuntimeKind)
      ? repoDefaultRuntimeKind
      : null;
  return (
    selectedSessionModel?.runtimeKind ??
    draftSelection?.runtimeKind ??
    roleDefaultSelection?.runtimeKind ??
    availableRepoDefaultRuntimeKind ??
    null
  );
};

export const resolvePreferredModelSelection = ({
  catalog,
  preferredSelection,
  fallbackSelection,
}: {
  catalog: AgentModelCatalog | null;
  preferredSelection: AgentModelSelection | null;
  fallbackSelection: AgentModelSelection | null;
}): AgentModelSelection | null => {
  const preferredBase =
    preferredSelection ?? fallbackSelection ?? pickDefaultVisibleSelectionForCatalog(catalog);
  return (
    coerceVisibleSelectionToCatalog(catalog, preferredBase) ??
    pickDefaultVisibleSelectionForCatalog(catalog)
  );
};

export type ChatComposerModelSelections = {
  selectionCatalog: AgentModelCatalog | null;
  selectedModelSelection: AgentModelSelection | null;
  selectionForNewSession: AgentModelSelection | null;
};

export const resolveChatComposerModelSelections = ({
  hasSessionTarget,
  sessionModelCatalog,
  composerCatalog,
  selectedSessionModel,
  draftSelection,
  roleDefaultSelection,
  isAwaitingRepoSettingsForWorkspaceRepoPath,
}: {
  hasSessionTarget: boolean;
  sessionModelCatalog: AgentModelCatalog | null;
  composerCatalog: AgentModelCatalog | null;
  selectedSessionModel: AgentModelSelection | null;
  draftSelection: AgentModelSelection | null;
  roleDefaultSelection: AgentModelSelection | null;
  isAwaitingRepoSettingsForWorkspaceRepoPath: boolean;
}): ChatComposerModelSelections => {
  const roleDefaultSelectionForComposer = resolveChatComposerRoleDefaultSelection({
    hasSessionTarget,
    composerCatalog,
    roleDefaultSelection,
    isAwaitingRepoSettingsForWorkspaceRepoPath,
  });
  const selectionCatalog = sessionModelCatalog ?? composerCatalog;
  const fallbackCatalogSelection = pickDefaultVisibleSelectionForCatalog(selectionCatalog);

  if (hasSessionTarget) {
    return {
      selectionCatalog,
      selectedModelSelection:
        resolveLoadedSessionVisibleSelection(selectionCatalog, selectedSessionModel) ??
        roleDefaultSelectionForComposer ??
        fallbackCatalogSelection,
      selectionForNewSession:
        draftSelection ?? roleDefaultSelectionForComposer ?? fallbackCatalogSelection,
    };
  }

  return {
    selectionCatalog,
    selectedModelSelection:
      draftSelection ?? roleDefaultSelectionForComposer ?? fallbackCatalogSelection,
    selectionForNewSession:
      draftSelection ?? roleDefaultSelectionForComposer ?? fallbackCatalogSelection,
  };
};

const resolveChatComposerRoleDefaultSelection = ({
  hasSessionTarget,
  composerCatalog,
  roleDefaultSelection,
  isAwaitingRepoSettingsForWorkspaceRepoPath,
}: {
  hasSessionTarget: boolean;
  composerCatalog: AgentModelCatalog | null;
  roleDefaultSelection: AgentModelSelection | null;
  isAwaitingRepoSettingsForWorkspaceRepoPath: boolean;
}): AgentModelSelection | null => {
  if (hasSessionTarget) {
    return roleDefaultSelection;
  }
  if (!composerCatalog) {
    return isAwaitingRepoSettingsForWorkspaceRepoPath ? null : roleDefaultSelection;
  }
  return coerceVisibleSelectionToCatalog(composerCatalog, roleDefaultSelection);
};

const resolveLoadedSessionVisibleSelection = (
  selectionCatalog: AgentModelCatalog | null,
  selectedSessionModel: AgentModelSelection | null,
): AgentModelSelection | null => {
  if (!selectedSessionModel) {
    return null;
  }
  return (
    coerceVisibleSelectionToCatalog(selectionCatalog, selectedSessionModel) ?? selectedSessionModel
  );
};
