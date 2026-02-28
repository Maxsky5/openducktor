import type { AgentModelCatalog } from "@openducktor/core";
import type { ComboboxOption } from "@/components/ui/combobox";
import { AGENT_ROLE_LABELS } from "@/types";
import type { RepoAgentDefaultInput, RepoSettingsInput } from "@/types/state-slices";

export type RepoDefaultRole = keyof RepoSettingsInput["agentDefaults"];

export const ROLE_DEFAULTS: ReadonlyArray<{
  role: RepoDefaultRole;
  label: string;
}> = [
  { role: "spec", label: AGENT_ROLE_LABELS.spec },
  { role: "planner", label: AGENT_ROLE_LABELS.planner },
  { role: "build", label: AGENT_ROLE_LABELS.build },
  { role: "qa", label: AGENT_ROLE_LABELS.qa },
];

const EMPTY_AGENT_DEFAULT: RepoAgentDefaultInput = {
  providerId: "",
  modelId: "",
  variant: "",
  opencodeAgent: "",
};

export const ensureAgentDefault = (value: RepoAgentDefaultInput | null): RepoAgentDefaultInput =>
  value ?? EMPTY_AGENT_DEFAULT;

export const updateRoleDefault = (
  agentDefaults: RepoSettingsInput["agentDefaults"],
  role: RepoDefaultRole,
  field: keyof RepoAgentDefaultInput,
  value: string,
): RepoSettingsInput["agentDefaults"] => {
  const next = ensureAgentDefault(agentDefaults[role]);
  return {
    ...agentDefaults,
    [role]: {
      ...next,
      [field]: value,
    },
  };
};

export const clearRoleDefault = (
  agentDefaults: RepoSettingsInput["agentDefaults"],
  role: RepoDefaultRole,
): RepoSettingsInput["agentDefaults"] => ({
  ...agentDefaults,
  [role]: null,
});

export const selectedModelKeyForRole = (
  agentDefaults: RepoSettingsInput["agentDefaults"],
  role: RepoDefaultRole,
): string => {
  const value = agentDefaults[role];
  if (!value?.providerId || !value.modelId) {
    return "";
  }
  return `${value.providerId}/${value.modelId}`;
};

export const findCatalogModel = (
  catalog: AgentModelCatalog | null,
  modelKey: string,
): AgentModelCatalog["models"][number] | null => {
  return catalog?.models.find((entry) => entry.id === modelKey) ?? null;
};

export const toRoleVariantOptions = (
  catalog: AgentModelCatalog | null,
  agentDefaults: RepoSettingsInput["agentDefaults"],
  role: RepoDefaultRole,
): ComboboxOption[] => {
  const model = findCatalogModel(catalog, selectedModelKeyForRole(agentDefaults, role));
  if (!model) {
    return [];
  }
  return model.variants.map((variant) => ({
    value: variant,
    label: variant,
  }));
};

export const getMissingRequiredRoleLabels = (
  agentDefaults: RepoSettingsInput["agentDefaults"],
): string[] => {
  return ROLE_DEFAULTS.filter(({ role }) => {
    const value = agentDefaults[role];
    return !(
      value &&
      value.providerId.trim().length > 0 &&
      value.modelId.trim().length > 0 &&
      value.opencodeAgent.trim().length > 0
    );
  }).map(({ label }) => label);
};
