import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import {
  coerceVisibleSelectionToCatalog,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
} from "@/features/session-start";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
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
  sessionModelRepairCommand: ChatComposerSessionModelRepairCommand | null;
  isSelectedSessionModelSendable: boolean;
};

export type ChatComposerSessionModelRepairCommand = {
  key: string;
  session: AgentSessionIdentity;
  selection: AgentModelSelection;
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
      sessionIdentity: AgentSessionIdentity | null;
      sessionRuntimeKind: RuntimeKind;
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
    const selectedSessionSelection = resolveLoadedSessionSelection({
      selectionCatalog,
      selectedSessionModel: source.selectedSessionModel,
      roleDefaultSelection,
      sessionRuntimeKind: source.sessionRuntimeKind,
    });

    return {
      selectionCatalog,
      selectedModelSelection: selectedSessionSelection.selectedModelSelection,
      selectionForNewSession:
        selectedSessionSelection.selectedModelSelection ??
        fallbackCatalogSelection ??
        roleDefaultSelection,
      sessionModelRepairCommand: resolveSessionModelRepairCommand({
        sessionIdentity: source.sessionIdentity,
        repairSelection: selectedSessionSelection.repairSelection,
      }),
      isSelectedSessionModelSendable: selectedSessionSelection.isSendable,
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
    sessionModelRepairCommand: null,
    isSelectedSessionModelSendable: true,
  };
};

export const resolveSessionModelRepairCommand = ({
  sessionIdentity,
  repairSelection,
}: {
  sessionIdentity: AgentSessionIdentity | null;
  repairSelection: AgentModelSelection | null;
}): ChatComposerSessionModelRepairCommand | null => {
  if (!sessionIdentity || !repairSelection) {
    return null;
  }

  return {
    key: [
      agentSessionIdentityKey(sessionIdentity),
      repairSelection.runtimeKind ?? "",
      repairSelection.providerId,
      repairSelection.modelId,
      repairSelection.variant ?? "",
      repairSelection.profileId ?? "",
    ].join("\u001f"),
    session: sessionIdentity,
    selection: repairSelection,
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

type LoadedSessionSelection = {
  selectedModelSelection: AgentModelSelection | null;
  repairSelection: AgentModelSelection | null;
  isSendable: boolean;
};

const coerceSessionSelectionToCatalog = ({
  selectionCatalog,
  selection,
  sessionRuntimeKind,
}: {
  selectionCatalog: AgentModelCatalog;
  selection: AgentModelSelection | null;
  sessionRuntimeKind: RuntimeKind;
}): AgentModelSelection | null => {
  if (!selection) {
    return null;
  }
  if (selection.runtimeKind && selection.runtimeKind !== sessionRuntimeKind) {
    return null;
  }

  return coerceVisibleSelectionToCatalog(selectionCatalog, {
    ...selection,
    runtimeKind: sessionRuntimeKind,
  });
};

const pickSessionCatalogDefaultSelection = (
  selectionCatalog: AgentModelCatalog,
  sessionRuntimeKind: RuntimeKind,
): AgentModelSelection | null => {
  const fallbackSelection = pickDefaultVisibleSelectionForCatalog(selectionCatalog);
  if (!fallbackSelection || fallbackSelection.runtimeKind !== sessionRuntimeKind) {
    return null;
  }
  return fallbackSelection;
};

const resolveLoadedSessionSelection = ({
  selectionCatalog,
  selectedSessionModel,
  roleDefaultSelection,
  sessionRuntimeKind,
}: {
  selectionCatalog: AgentModelCatalog | null;
  selectedSessionModel: AgentModelSelection | null;
  roleDefaultSelection: AgentModelSelection | null;
  sessionRuntimeKind: RuntimeKind;
}): LoadedSessionSelection => {
  if (!selectedSessionModel) {
    return {
      selectedModelSelection: null,
      repairSelection: null,
      isSendable: true,
    };
  }

  if (!selectionCatalog) {
    return {
      selectedModelSelection: selectedSessionModel,
      repairSelection: null,
      isSendable: true,
    };
  }

  const normalizedSessionSelection = coerceSessionSelectionToCatalog({
    selectionCatalog,
    selection: selectedSessionModel,
    sessionRuntimeKind,
  });
  const fallbackRoleDefaultSelection = coerceSessionSelectionToCatalog({
    selectionCatalog,
    selection: roleDefaultSelection,
    sessionRuntimeKind,
  });
  const fallbackCatalogSelection = pickSessionCatalogDefaultSelection(
    selectionCatalog,
    sessionRuntimeKind,
  );
  const selectedModelSelection =
    normalizedSessionSelection ?? fallbackRoleDefaultSelection ?? fallbackCatalogSelection;

  if (!selectedModelSelection) {
    return {
      selectedModelSelection: null,
      repairSelection: null,
      isSendable: false,
    };
  }

  const repairSelection = isSameSelection(selectedSessionModel, selectedModelSelection)
    ? null
    : selectedModelSelection;

  return {
    selectedModelSelection,
    repairSelection,
    isSendable: repairSelection === null,
  };
};
