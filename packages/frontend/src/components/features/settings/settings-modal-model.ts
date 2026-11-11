import { resolveRuntimeKindSelection } from "@openducktor/frontend-core/lib/agent-runtime";
import type { SettingsRepoConfig, RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import {
  ensureDraftAgentDefault,
  resolveRepoAgentDefaultRuntimeKind,
  type RepoAgentDefaultsInput,
  type RepoDefaultRole,
} from "@/components/features/repository/model-defaults/model-defaults-model";
import type {
  RepoAgentDefaultDraft,
  ModelDefaultDraft,
} from "@openducktor/frontend-core/lib/repo-agent-defaults";
import type { RepoAgentDefaultInput } from "@/types/state-slices";

export {
  ensureDraftAgentDefault,
  findCatalogModel,
  resolveRepoAgentDefaultRuntimeKind,
  selectedModelKey,
  selectedModelKeyForRole,
  toRoleVariantOptions,
  toVariantOptionsForModelKey,
} from "@/components/features/repository/model-defaults/model-defaults-model";

export const isSettingsInteractionDisabled = ({
  isLoadingSettings,
  isSaving,
}: {
  isLoadingSettings: boolean;
  isSaving: boolean;
  isCheckingRuntimeExecutables: boolean;
}): boolean => isLoadingSettings || isSaving;

export const updateRoleDefault = (
  agentDefaults: RepoAgentDefaultsInput,
  role: RepoDefaultRole,
  field: keyof RepoAgentDefaultInput,
  value: string,
): RepoAgentDefaultsInput => {
  const next = ensureDraftAgentDefault(agentDefaults[role]);
  return {
    ...agentDefaults,
    [role]: {
      ...next,
      [field]: value,
    },
  };
};

export const updateRepoDefaultModel = (
  defaultModel: RepoAgentDefaultDraft | null | undefined,
  field: keyof RepoAgentDefaultInput,
  value: string,
): ModelDefaultDraft | null => {
  const draft = ensureDraftAgentDefault(defaultModel);
  const runtimeKind = draft.runtimeKind;
  if (!runtimeKind) {
    return null;
  }
  return { ...draft, runtimeKind, [field]: value };
};

export const clearRoleDefault = (
  agentDefaults: RepoAgentDefaultsInput,
  role: RepoDefaultRole,
): RepoAgentDefaultsInput => ({
  ...agentDefaults,
  [role]: null,
});

export const getNeededCatalogRuntimeKinds = (
  selectedRepoConfig: SettingsRepoConfig | null,
  runtimeDefinitions: RuntimeDescriptor[],
): RuntimeKind[] => {
  if (!selectedRepoConfig || runtimeDefinitions.length === 0) {
    return [];
  }

  const runtimeKinds = new Set<RuntimeKind>();
  const defaultRuntime = resolveRuntimeKindSelection({
    runtimeDefinitions,
    requestedRuntimeKind: selectedRepoConfig.defaultModel?.runtimeKind ?? null,
  });
  if (defaultRuntime) runtimeKinds.add(defaultRuntime);
  for (const role of Object.keys(selectedRepoConfig.agentDefaults)) {
    const resolvedRuntimeKind = resolveRepoAgentDefaultRuntimeKind({
      selectedRepoConfig,
      runtimeDefinitions,
      role,
    });
    if (resolvedRuntimeKind) {
      runtimeKinds.add(resolvedRuntimeKind);
    }
  }

  return [...runtimeKinds];
};
