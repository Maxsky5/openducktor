import type { RuntimeDescriptor } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import type { RepoSettingsInput } from "@/types/state-slices";

export {
  coerceVisibleSelectionToCatalog,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
} from "@/features/model-selection/model-selection-state";

export const roleDefaultSelectionFor = (
  repoSettings: RepoSettingsInput | null,
  role: AgentRole,
): AgentModelSelection | null => {
  const roleDefault = repoSettings?.agentDefaults[role];
  if (!roleDefault?.providerId || !roleDefault.modelId) {
    return null;
  }

  const runtimeKind = roleDefault.runtimeKind ?? repoSettings?.defaultRuntimeKind ?? null;
  if (!runtimeKind) {
    return null;
  }

  return {
    runtimeKind,
    providerId: roleDefault.providerId,
    modelId: roleDefault.modelId,
    ...(roleDefault.variant ? { variant: roleDefault.variant } : undefined),
    ...(roleDefault.profileId ? { profileId: roleDefault.profileId } : undefined),
  };
};

export const availableRoleDefaultSelectionFor = ({
  repoSettings,
  role,
  runtimeDefinitions,
}: {
  repoSettings: RepoSettingsInput | null;
  role: AgentRole;
  runtimeDefinitions: RuntimeDescriptor[];
}): AgentModelSelection | null => {
  const selection = roleDefaultSelectionFor(repoSettings, role);
  const runtimeKind = selection?.runtimeKind;
  if (!selection || !runtimeKind) {
    return null;
  }

  return findRuntimeDefinition(runtimeDefinitions, runtimeKind) ? selection : null;
};
