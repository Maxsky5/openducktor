import { type RepoPromptOverrides } from "@openducktor/contracts";
import { BUILTIN_PROMPT_TEMPLATE_IDS } from "@openducktor/workflows";

const trimPromptTemplate = (template: string): string => template.trim();

export const preparePromptOverridesForSave = (overrides: RepoPromptOverrides) => {
  const next: RepoPromptOverrides = {};

  for (const templateId of BUILTIN_PROMPT_TEMPLATE_IDS) {
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
