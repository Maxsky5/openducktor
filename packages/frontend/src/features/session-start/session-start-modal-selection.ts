import type { RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  coerceVisibleSelectionToCatalog,
  pickDefaultVisibleSelectionForCatalog,
  roleDefaultSelectionFor,
} from "./session-start-selection";

export const resolveInitialModalSelection = ({
  catalog,
  repoSettings,
  role,
  runtimeKind,
  selectedModel,
}: {
  catalog: AgentModelCatalog | null;
  repoSettings: RepoSettingsInput | null;
  role: AgentRole;
  runtimeKind: RuntimeKind | null;
  selectedModel: AgentModelSelection | null;
}): AgentModelSelection | null => {
  if (!runtimeKind) {
    return null;
  }
  const requestedSelection =
    selectedModel?.runtimeKind === runtimeKind
      ? coerceVisibleSelectionToCatalog(catalog, selectedModel)
      : null;
  const roleDefault = roleDefaultSelectionFor(repoSettings, role);
  const runtimeRoleDefault = roleDefault?.runtimeKind === runtimeKind ? roleDefault : null;
  const catalogDefault = pickDefaultVisibleSelectionForCatalog(catalog);

  return (
    requestedSelection ??
    coerceVisibleSelectionToCatalog(catalog, runtimeRoleDefault) ??
    (catalogDefault ? { ...catalogDefault, runtimeKind } : null) ??
    runtimeRoleDefault
  );
};

export const resolveSelectionForRuntimeChange = ({
  activeRole,
  currentSelection,
  intentSelectedModel,
  repoSettings,
  runtimeKind,
}: {
  activeRole: AgentRole | null;
  currentSelection: AgentModelSelection | null;
  intentSelectedModel: AgentModelSelection | null;
  repoSettings: RepoSettingsInput | null;
  runtimeKind: RuntimeKind;
}): AgentModelSelection | null => {
  if (!activeRole) {
    return currentSelection ? { ...currentSelection, runtimeKind } : currentSelection;
  }

  return resolveInitialModalSelection({
    catalog: null,
    repoSettings,
    role: activeRole,
    runtimeKind,
    selectedModel: currentSelection ? { ...currentSelection, runtimeKind } : intentSelectedModel,
  });
};

export const resolveSelectionForAgentChange = ({
  activeRole,
  catalog,
  currentSelection,
  intentSelectedModel,
  profileId,
  repoSettings,
  runtimeKind,
}: {
  activeRole: AgentRole | null;
  catalog: AgentModelCatalog | null;
  currentSelection: AgentModelSelection | null;
  intentSelectedModel: AgentModelSelection | null;
  profileId: string;
  repoSettings: RepoSettingsInput | null;
  runtimeKind: RuntimeKind;
}): AgentModelSelection | null => {
  const baseSelection =
    currentSelection ??
    (activeRole
      ? resolveInitialModalSelection({
          catalog,
          repoSettings,
          role: activeRole,
          runtimeKind,
          selectedModel: intentSelectedModel,
        })
      : null) ??
    pickDefaultVisibleSelectionForCatalog(catalog);

  if (!baseSelection) {
    return null;
  }

  return {
    ...baseSelection,
    profileId,
  };
};

export const resolveSelectionForModelChange = ({
  catalog,
  currentSelection,
  modelKey,
  runtimeKind,
}: {
  catalog: AgentModelCatalog | null;
  currentSelection: AgentModelSelection | null;
  modelKey: string;
  runtimeKind: RuntimeKind;
}): AgentModelSelection | null => {
  if (!catalog) {
    return currentSelection;
  }

  const model = catalog.models.find((entry) => entry.id === modelKey);
  if (!model) {
    return currentSelection;
  }

  return {
    runtimeKind,
    providerId: model.providerId,
    modelId: model.modelId,
    ...(model.variants[0] ? { variant: model.variants[0] } : {}),
    ...(currentSelection?.profileId ? { profileId: currentSelection.profileId } : {}),
  };
};

export const resolveSelectionForVariantChange = ({
  currentSelection,
  variant,
}: {
  currentSelection: AgentModelSelection | null;
  variant: string;
}): AgentModelSelection | null => {
  if (!currentSelection) {
    return currentSelection;
  }

  return {
    ...currentSelection,
    variant,
  };
};
