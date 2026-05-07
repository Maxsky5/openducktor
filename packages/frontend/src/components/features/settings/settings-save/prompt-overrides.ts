import type { AgentPromptTemplateId, RepoPromptOverrides } from "@openducktor/contracts";

const trimPromptTemplate = (template: string): string => template.trim();

export const preparePromptOverridesForSave = (
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
      template: trimPromptTemplate(entry.template),
      baseVersion: Math.max(1, Math.trunc(entry.baseVersion || 1)),
      enabled: entry.enabled !== false,
    };
  }

  return next;
};
