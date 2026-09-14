import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelSelection, AgentRole } from "@openducktor/core";
import { findRuntimeDefinition } from "@/lib/agent-runtime";
import type { RepoSettingsInput } from "@/types/state-slices";

export {
  coerceVisibleSelectionToCatalog,
  isSameSelection,
  pickDefaultVisibleSelectionForCatalog,
} from "@/features/model-selection/model-selection-state";

type RepoModelDefaultLike = {
  runtimeKind?: RuntimeKind | null;
  providerId: string;
  modelId: string;
  variant?: string | null | undefined;
  profileId?: string | null | undefined;
};

export type RuntimeBoundModelSelection = AgentModelSelection & { runtimeKind: RuntimeKind };

const toAgentModelSelection = (value: RepoModelDefaultLike): RuntimeBoundModelSelection | null => {
  if (!value.providerId || !value.modelId || !value.runtimeKind) {
    return null;
  }

  const selection: RuntimeBoundModelSelection = {
    runtimeKind: value.runtimeKind,
    providerId: value.providerId,
    modelId: value.modelId,
  };
  if (value.variant) {
    selection.variant = value.variant;
  }
  if (value.profileId) {
    selection.profileId = value.profileId;
  }
  return selection;
};

export const roleDefaultSelectionFor = (
  repoSettings: RepoSettingsInput | null,
  role: AgentRole,
): RuntimeBoundModelSelection | null => {
  const roleDefault = repoSettings?.agentDefaults[role];
  return roleDefault ? toAgentModelSelection(roleDefault) : null;
};

export const repoDefaultModelSelectionFor = (
  repoSettings: RepoSettingsInput | null,
): RuntimeBoundModelSelection | null => {
  const defaultModel = repoSettings?.defaultModel;
  return defaultModel ? toAgentModelSelection(defaultModel) : null;
};

export const defaultSessionSelectionFor = (
  repoSettings: RepoSettingsInput | null,
  role: AgentRole,
): RuntimeBoundModelSelection | null =>
  roleDefaultSelectionFor(repoSettings, role) ?? repoDefaultModelSelectionFor(repoSettings);

export const availableDefaultSessionSelectionFor = ({
  repoSettings,
  role,
  runtimeDefinitions,
}: {
  repoSettings: RepoSettingsInput | null;
  role: AgentRole;
  runtimeDefinitions: RuntimeDescriptor[];
}): RuntimeBoundModelSelection | null => {
  const selection = defaultSessionSelectionFor(repoSettings, role);
  if (!selection) {
    return null;
  }

  return findRuntimeDefinition(runtimeDefinitions, selection.runtimeKind) ? selection : null;
};
