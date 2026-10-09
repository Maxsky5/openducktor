import type { RuntimeDescriptor, RuntimeKind } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { catalogModelOptionValue } from "@/components/features/agents/catalog-select-options";
import type { ComboboxOption } from "@/components/ui/combobox";
import { resolveRuntimeKindSelection } from "@/lib/agent-runtime";
import { pickRepoAgentDefault, type RepoAgentDefaultDraft } from "@/lib/repo-agent-defaults";
import { AGENT_ROLE_LABELS } from "@/types";
import type {
  RepoAgentDefaultInput,
  RepoSettingsInput,
  WorkspaceModelDefaultsDraft,
} from "@/types/state-slices";

export type RepoDefaultRole = keyof RepoSettingsInput["agentDefaults"];
export type RepoAgentDefaultsInput = Partial<
  Record<RepoDefaultRole, RepoAgentDefaultDraft | null | undefined>
>;

export const ROLE_DEFAULTS: ReadonlyArray<{ role: RepoDefaultRole; label: string }> = [
  { role: "spec", label: AGENT_ROLE_LABELS.spec },
  { role: "planner", label: AGENT_ROLE_LABELS.planner },
  { role: "build", label: AGENT_ROLE_LABELS.build },
  { role: "qa", label: AGENT_ROLE_LABELS.qa },
];

export const ensureDraftAgentDefault = (
  value: RepoAgentDefaultDraft | null | undefined,
): RepoAgentDefaultInput => {
  const draft: RepoAgentDefaultInput = {
    providerId: value?.providerId ?? "",
    modelId: value?.modelId ?? "",
    variant: value?.variant ?? "",
    profileId: value?.profileId ?? "",
  };
  if (value?.runtimeKind) draft.runtimeKind = value.runtimeKind;
  return draft;
};

export const selectedModelKey = (value: { providerId: string; modelId: string } | null): string => {
  if (!value?.providerId || !value.modelId) return "";
  return `${value.providerId}/${value.modelId}`;
};

export const selectedModelKeyForRole = (
  agentDefaults: RepoAgentDefaultsInput,
  role: RepoDefaultRole,
): string => selectedModelKey(agentDefaults[role] ?? null);

export const findCatalogModel = (
  catalog: AgentModelCatalog | null,
  modelKey: string,
): AgentModelCatalog["models"][number] | null =>
  catalog?.models.find(
    (entry) => entry.id === modelKey || catalogModelOptionValue(entry) === modelKey,
  ) ?? null;

export const toVariantOptionsForModelKey = (
  catalog: AgentModelCatalog | null,
  modelKey: string,
): ComboboxOption[] => {
  const model = findCatalogModel(catalog, modelKey);
  if (!model) return [];
  return model.variants.map((variant) => ({ value: variant, label: variant }));
};

export const toRoleVariantOptions = (
  catalog: AgentModelCatalog | null,
  agentDefaults: RepoAgentDefaultsInput,
  role: RepoDefaultRole,
): ComboboxOption[] =>
  toVariantOptionsForModelKey(catalog, selectedModelKeyForRole(agentDefaults, role));

export const resolveRepoAgentDefaultRuntimeKind = ({
  selectedRepoConfig,
  runtimeDefinitions,
  role,
}: {
  selectedRepoConfig: WorkspaceModelDefaultsDraft;
  runtimeDefinitions: RuntimeDescriptor[];
  role: RepoDefaultRole;
}): RuntimeKind | null => {
  const requestedRuntimeKind =
    pickRepoAgentDefault(selectedRepoConfig.agentDefaults[role], selectedRepoConfig.defaultModel)
      ?.runtimeKind ?? null;
  return resolveRuntimeKindSelection({ runtimeDefinitions, requestedRuntimeKind });
};
