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

export type ChatComposerModelSelectionSource =
  | {
      kind: "new_session";
      composerCatalog: AgentModelCatalog | null;
      draftSelection: AgentModelSelection | null;
      isAwaitingRepoSettingsForWorkspaceRepoPath: boolean;
    }
  | {
      kind: "session";
      modelCatalog: AgentModelCatalog | null;
      selectedSessionModel: AgentModelSelection | null;
      draftSelection: AgentModelSelection | null;
    };

export const resolveChatComposerModelSelections = ({
  source,
  roleDefaultSelection,
}: {
  source: ChatComposerModelSelectionSource;
  roleDefaultSelection: AgentModelSelection | null;
}): ChatComposerModelSelections => {
  if (source.kind === "session") {
    const selectionCatalog = source.modelCatalog;
    const fallbackCatalogSelection = pickDefaultVisibleSelectionForCatalog(selectionCatalog);

    return {
      selectionCatalog,
      selectedModelSelection:
        resolveLoadedSessionVisibleSelection(selectionCatalog, source.selectedSessionModel) ??
        roleDefaultSelection ??
        fallbackCatalogSelection,
      selectionForNewSession:
        source.draftSelection ?? roleDefaultSelection ?? fallbackCatalogSelection,
    };
  }

  const roleDefaultSelectionForComposer = resolveNewSessionRoleDefaultSelection({
    composerCatalog: source.composerCatalog,
    roleDefaultSelection,
    isAwaitingRepoSettingsForWorkspaceRepoPath: source.isAwaitingRepoSettingsForWorkspaceRepoPath,
  });
  const selectionCatalog = source.composerCatalog;
  const fallbackCatalogSelection = pickDefaultVisibleSelectionForCatalog(selectionCatalog);

  return {
    selectionCatalog,
    selectedModelSelection:
      source.draftSelection ?? roleDefaultSelectionForComposer ?? fallbackCatalogSelection,
    selectionForNewSession:
      source.draftSelection ?? roleDefaultSelectionForComposer ?? fallbackCatalogSelection,
  };
};

const resolveNewSessionRoleDefaultSelection = ({
  composerCatalog,
  roleDefaultSelection,
  isAwaitingRepoSettingsForWorkspaceRepoPath,
}: {
  composerCatalog: AgentModelCatalog | null;
  roleDefaultSelection: AgentModelSelection | null;
  isAwaitingRepoSettingsForWorkspaceRepoPath: boolean;
}): AgentModelSelection | null => {
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
