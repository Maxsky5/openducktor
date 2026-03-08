import {
  type AgentPromptTemplateId,
  type RepoPromptOverrides,
  validatePromptTemplatePlaceholders,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { ComboboxOption } from "@/components/ui/combobox";
import { DEFAULT_RUNTIME_KIND } from "@/lib/agent-runtime";
import { AGENT_ROLE_LABELS } from "@/types";
import type { RepoAgentDefaultInput, RepoSettingsInput } from "@/types/state-slices";

export type RepoDefaultRole = keyof RepoSettingsInput["agentDefaults"];
type RepoAgentDefaultLike = {
  runtimeKind?: string;
  providerId: string;
  modelId: string;
  variant?: string | undefined;
  profileId?: string | undefined;
};
export type RepoAgentDefaultsInput = {
  spec?: RepoAgentDefaultLike | null | undefined;
  planner?: RepoAgentDefaultLike | null | undefined;
  build?: RepoAgentDefaultLike | null | undefined;
  qa?: RepoAgentDefaultLike | null | undefined;
};

export const ROLE_DEFAULTS: ReadonlyArray<{
  role: RepoDefaultRole;
  label: string;
}> = [
  { role: "spec", label: AGENT_ROLE_LABELS.spec },
  { role: "planner", label: AGENT_ROLE_LABELS.planner },
  { role: "build", label: AGENT_ROLE_LABELS.build },
  { role: "qa", label: AGENT_ROLE_LABELS.qa },
];

export const ensureAgentDefault = (
  value:
    | {
        runtimeKind?: string;
        providerId: string;
        modelId: string;
        variant?: string | undefined;
        profileId?: string | undefined;
      }
    | null
    | undefined,
): RepoAgentDefaultInput => ({
  runtimeKind: value?.runtimeKind ?? DEFAULT_RUNTIME_KIND,
  providerId: value?.providerId ?? "",
  modelId: value?.modelId ?? "",
  variant: value?.variant ?? "",
  profileId: value?.profileId ?? "",
});

export const updateRoleDefault = (
  agentDefaults: RepoAgentDefaultsInput,
  role: RepoDefaultRole,
  field: keyof RepoAgentDefaultInput,
  value: string,
): RepoAgentDefaultsInput => {
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
  agentDefaults: RepoAgentDefaultsInput,
  role: RepoDefaultRole,
): RepoAgentDefaultsInput => ({
  ...agentDefaults,
  [role]: null,
});

export const selectedModelKeyForRole = (
  agentDefaults: RepoAgentDefaultsInput,
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
  agentDefaults: RepoAgentDefaultsInput,
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

export const getMissingRequiredRoleLabels = (agentDefaults: RepoAgentDefaultsInput): string[] => {
  return ROLE_DEFAULTS.filter(({ role }) => {
    const value = agentDefaults[role];
    return !(
      value &&
      value.providerId.trim().length > 0 &&
      value.modelId.trim().length > 0 &&
      (value.profileId?.trim().length ?? 0) > 0
    );
  }).map(({ label }) => label);
};

const normalizeTemplateForComparison = (value: string | undefined): string =>
  (value ?? "").replaceAll("\r\n", "\n").trim();

export const canResetPromptOverrideToBuiltin = (
  override: RepoPromptOverrides[AgentPromptTemplateId] | undefined,
  builtinTemplate: string,
): boolean =>
  Boolean(
    override &&
      normalizeTemplateForComparison(override.template) !==
        normalizeTemplateForComparison(builtinTemplate),
  );

export const resetPromptOverrideToBuiltin = (
  overrides: RepoPromptOverrides,
  templateId: AgentPromptTemplateId,
  builtinTemplate: string,
  builtinVersion: number,
): RepoPromptOverrides => {
  const existing = overrides[templateId];
  if (!existing) {
    return overrides;
  }

  return {
    ...overrides,
    [templateId]: {
      ...existing,
      template: builtinTemplate,
      baseVersion: builtinVersion,
    },
  };
};

export const togglePromptOverrideEnabled = (
  overrides: RepoPromptOverrides,
  templateId: AgentPromptTemplateId,
  nextEnabled: boolean,
  fallbackTemplate: string,
  fallbackBaseVersion: number,
): RepoPromptOverrides => {
  const existing = overrides[templateId];
  if (nextEnabled) {
    return {
      ...overrides,
      [templateId]: {
        template: existing?.template ?? fallbackTemplate,
        baseVersion: existing?.baseVersion ?? fallbackBaseVersion,
        enabled: true,
      },
    };
  }

  if (!existing) {
    return overrides;
  }

  return {
    ...overrides,
    [templateId]: {
      ...existing,
      enabled: false,
    },
  };
};

export const resolvePromptOverrideFallbackTemplate = (
  inheritedTemplate: string | undefined,
  builtinTemplate: string,
): string => inheritedTemplate ?? builtinTemplate;

export const updatePromptOverrideTemplate = (
  overrides: RepoPromptOverrides,
  templateId: AgentPromptTemplateId,
  nextTemplate: string,
  fallbackBaseVersion: number,
): RepoPromptOverrides => {
  const existing = overrides[templateId];
  return {
    ...overrides,
    [templateId]: {
      template: nextTemplate,
      baseVersion: existing?.baseVersion ?? fallbackBaseVersion,
      enabled: existing ? existing.enabled !== false : false,
    },
  };
};

export const removePromptOverride = (
  overrides: RepoPromptOverrides,
  templateId: AgentPromptTemplateId,
): RepoPromptOverrides => {
  if (!overrides[templateId]) {
    return overrides;
  }

  const next = { ...overrides };
  delete next[templateId];
  return next;
};

export type PromptOverrideValidationErrors = Partial<Record<AgentPromptTemplateId, string>>;

export const buildPromptOverrideValidationErrors = (
  overrides: RepoPromptOverrides,
): PromptOverrideValidationErrors => {
  const errors: PromptOverrideValidationErrors = {};

  for (const [templateId, override] of Object.entries(overrides) as Array<
    [AgentPromptTemplateId, RepoPromptOverrides[AgentPromptTemplateId]]
  >) {
    if (!override) {
      continue;
    }

    const { unsupportedPlaceholders } = validatePromptTemplatePlaceholders(override.template);
    if (unsupportedPlaceholders.length === 0) {
      continue;
    }

    const formattedPlaceholders = unsupportedPlaceholders
      .map((placeholder) => `{{${placeholder}}}`)
      .join(", ");
    const suffix = unsupportedPlaceholders.length > 1 ? "s" : "";
    errors[templateId] = `Unsupported placeholder${suffix}: ${formattedPlaceholders}.`;
  }

  return errors;
};
