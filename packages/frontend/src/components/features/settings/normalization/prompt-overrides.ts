import type { AgentPromptTemplateId, RepoPromptOverrides } from "@openducktor/contracts";

const normalizePromptTemplate = (template: string): string => template.trim();

export const normalizePromptOverridesForSave = (
  overrides: RepoPromptOverrides,
): RepoPromptOverrides => {
  const next: RepoPromptOverrides = {};

  for (const [templateId, entry] of Object.entries(overrides) as Array<
    [AgentPromptTemplateId, RepoPromptOverrides[AgentPromptTemplateId]]
  >) {
    if (!entry) {
      continue;
    }

    next[templateId] = {
      template: normalizePromptTemplate(entry.template),
      baseVersion: Math.max(1, Math.trunc(entry.baseVersion || 1)),
      enabled: entry.enabled !== false,
    };
  }

  return next;
};

export type PromptInheritedPreview = {
  sourceLabel: string;
  template: string;
};

export const resolveInheritedPromptPreview = (
  templateId: AgentPromptTemplateId,
  repoOverride: RepoPromptOverrides[AgentPromptTemplateId] | undefined,
  globalOverrides: RepoPromptOverrides,
  builtinTemplate: string,
): PromptInheritedPreview | undefined => {
  if (repoOverride && repoOverride.enabled !== false) {
    return undefined;
  }

  const globalOverride = globalOverrides[templateId];
  const globalEnabledOverride =
    globalOverride && globalOverride.enabled !== false ? globalOverride : undefined;

  return {
    sourceLabel: globalEnabledOverride ? "Global override" : "Builtin prompt",
    template: globalEnabledOverride?.template ?? builtinTemplate,
  };
};
