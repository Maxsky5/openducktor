import {
  type AgentPromptTemplateId,
  type RepoConfig,
  type RepoPromptOverrides,
  type RuntimeDescriptor,
  type RuntimeKind,
  validatePromptTemplatePlaceholders,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { ComboboxOption } from "@/components/ui/combobox";
import { resolveRuntimeKindSelection } from "@/lib/agent-runtime";
import { AGENT_ROLE_LABELS } from "@/types";
import type { RepoAgentDefaultInput, RepoSettingsInput } from "@/types/state-slices";

type RepoDefaultRole = keyof RepoSettingsInput["agentDefaults"];
type RepoAgentDefaultLike = {
  runtimeKind?: string | null;
  providerId: string;
  modelId: string;
  variant?: string | undefined;
  profileId?: string | undefined;
};
type RepoAgentDefaultsInput = {
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

export const ensureDraftAgentDefault = (
  value:
    | {
        runtimeKind?: string | null;
        providerId: string;
        modelId: string;
        variant?: string | undefined;
        profileId?: string | undefined;
      }
    | null
    | undefined,
): RepoAgentDefaultInput => ({
  runtimeKind: value?.runtimeKind ?? "",
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
  const next = ensureDraftAgentDefault(agentDefaults[role]);
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

export const ensureAgentDefault = ensureDraftAgentDefault;

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

export const resolveRepoAgentDefaultRuntimeKind = ({
  selectedRepoConfig,
  runtimeDefinitions,
  role,
}: {
  selectedRepoConfig: RepoConfig;
  runtimeDefinitions: RuntimeDescriptor[];
  role: RepoDefaultRole;
}): RuntimeKind | null => {
  const requestedRuntimeKind =
    selectedRepoConfig.agentDefaults[role]?.runtimeKind ?? selectedRepoConfig.defaultRuntimeKind;

  return resolveRuntimeKindSelection({
    runtimeDefinitions,
    requestedRuntimeKind,
  });
};

export const getNeededCatalogRuntimeKinds = (
  selectedRepoConfig: RepoConfig | null,
  runtimeDefinitions: RuntimeDescriptor[],
): RuntimeKind[] => {
  if (!selectedRepoConfig || runtimeDefinitions.length === 0) {
    return [];
  }

  const runtimeKinds = new Set<RuntimeKind>();
  for (const { role } of ROLE_DEFAULTS) {
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

export const canResetPromptOverrideToBuiltin = (
  override: RepoPromptOverrides[AgentPromptTemplateId] | undefined,
  _builtinTemplate: string,
): boolean => Boolean(override);

export const resetPromptOverrideToBuiltin = (
  overrides: RepoPromptOverrides,
  templateId: AgentPromptTemplateId,
): RepoPromptOverrides => {
  const existing = overrides[templateId];
  if (!existing) {
    return overrides;
  }

  const next = { ...overrides };
  delete next[templateId];
  return next;
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

type PromptOverrideValidationErrors = Partial<Record<AgentPromptTemplateId, string>>;

const formatPlaceholders = (placeholders: string[]): string => {
  return placeholders.map((placeholder) => `{{${placeholder}}}`).join(", ");
};

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

    const { unsupportedPlaceholders, missingRequiredPlaceholders } =
      validatePromptTemplatePlaceholders(override.template, templateId);
    if (unsupportedPlaceholders.length === 0 && missingRequiredPlaceholders.length === 0) {
      continue;
    }

    const messages: string[] = [];
    if (unsupportedPlaceholders.length > 0) {
      const suffix = unsupportedPlaceholders.length > 1 ? "s" : "";
      messages.push(
        `Unsupported placeholder${suffix}: ${formatPlaceholders(unsupportedPlaceholders)}.`,
      );
    }
    if (missingRequiredPlaceholders.length > 0) {
      const suffix = missingRequiredPlaceholders.length > 1 ? "s" : "";
      messages.push(
        `Missing required placeholder${suffix}: ${formatPlaceholders(missingRequiredPlaceholders)}.`,
      );
    }

    errors[templateId] = messages.join(" ");
  }

  return errors;
};
