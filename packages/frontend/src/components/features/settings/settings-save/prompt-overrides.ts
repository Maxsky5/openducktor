import { agentPromptTemplateIdValues, type RepoPromptOverrides } from "@openducktor/contracts";

const trimPromptTemplate = (template: string): string => template.trim();

export const preparePromptOverridesForSave = (overrides: RepoPromptOverrides) => {
  const next: RepoPromptOverrides = {};

  for (const templateId of agentPromptTemplateIdValues) {
    const entry = overrides[templateId];
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
