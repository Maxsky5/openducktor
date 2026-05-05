import type { AgentModelCatalog, AgentModelSelection, AgentRole } from "@openducktor/core";
import {
  coerceVisibleSelectionToCatalog,
  pickDefaultVisibleSelectionForCatalog,
} from "@/features/session-start";
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

const resolvePreferredModelSelectionForCatalog = ({
  catalog,
  primarySelection,
  secondarySelection,
}: {
  catalog: AgentModelCatalog | null;
  primarySelection: AgentModelSelection | null;
  secondarySelection: AgentModelSelection | null;
}): AgentModelSelection | null => {
  const preferredBase =
    primarySelection ?? secondarySelection ?? pickDefaultVisibleSelectionForCatalog(catalog);
  return (
    coerceVisibleSelectionToCatalog(catalog, preferredBase) ??
    pickDefaultVisibleSelectionForCatalog(catalog)
  );
};

export const resolveDraftModelSelection = ({
  catalog,
  existingSelection,
  roleDefaultSelection,
}: {
  catalog: AgentModelCatalog | null;
  existingSelection: AgentModelSelection | null;
  roleDefaultSelection: AgentModelSelection | null;
}): AgentModelSelection | null => {
  return resolvePreferredModelSelectionForCatalog({
    catalog,
    primarySelection: existingSelection,
    secondarySelection: roleDefaultSelection,
  });
};

export const resolveActiveSessionModelSelection = ({
  catalog,
  selectedModel,
  roleDefaultSelection,
}: {
  catalog: AgentModelCatalog | null;
  selectedModel: AgentModelSelection | null;
  roleDefaultSelection: AgentModelSelection | null;
}): AgentModelSelection | null => {
  return resolvePreferredModelSelectionForCatalog({
    catalog,
    primarySelection: selectedModel,
    secondarySelection: roleDefaultSelection,
  });
};
