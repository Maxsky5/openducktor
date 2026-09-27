import {
  type AgentPromptTemplateId,
  agentPromptTemplateIdValues,
  type SettingsRepoConfig,
  type RepoPromptOverrides,
  type RuntimeDescriptor,
  type RuntimeKind,
  validatePromptTemplatePlaceholders,
} from "@openducktor/contracts";
import {
  ensureDraftAgentDefault,
  ROLE_DEFAULTS,
  resolveRepoAgentDefaultRuntimeKind,
  type RepoAgentDefaultsInput,
  type RepoDefaultRole,
} from "@/components/features/repository/model-defaults/model-defaults-model";
import type { RepoAgentDefaultDraft, RuntimeBoundModelSelection } from "@/lib/repo-agent-defaults";
import type { RepoAgentDefaultInput } from "@/types/state-slices";

export {
  ensureDraftAgentDefault,
  findCatalogModel,
  ROLE_DEFAULTS,
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
): RuntimeBoundModelSelection | null => {
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

export const getMissingRequiredRoleLabels = (agentDefaults: RepoAgentDefaultsInput): string[] => {
  return ROLE_DEFAULTS.reduce<string[]>((labels, { role, label }) => {
    const value = agentDefaults[role];
    const hasRequiredDefault =
      value &&
      value.providerId.trim().length > 0 &&
      value.modelId.trim().length > 0 &&
      (value.profileId?.trim().length ?? 0) > 0;
    if (!hasRequiredDefault) {
      labels.push(label);
    }
    return labels;
  }, []);
};

export const getNeededCatalogRuntimeKinds = (
  selectedRepoConfig: SettingsRepoConfig | null,
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

export const canClearPromptOverride = (
  override: RepoPromptOverrides[AgentPromptTemplateId] | undefined,
): boolean => Boolean(override);

export const clearPromptOverride = (
  overrides: RepoPromptOverrides,
  templateId: AgentPromptTemplateId,
) => {
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
) => {
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
) => {
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

type PromptOverrideValidationErrors = Partial<Record<AgentPromptTemplateId, string>>;

const formatPlaceholders = (placeholders: string[]): string => {
  return placeholders.map((placeholder) => `{{${placeholder}}}`).join(", ");
};

export const buildPromptOverrideValidationErrors = (overrides: RepoPromptOverrides) => {
  const errors: PromptOverrideValidationErrors = {};

  for (const templateId of agentPromptTemplateIdValues) {
    const override = overrides[templateId];
    if (!override || override.enabled === false) {
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

  return errors satisfies PromptOverrideValidationErrors;
};
