import type { RepoPromptAppends, RepoPromptOverrides } from "@openducktor/contracts";

const trimPromptTemplate = (template: string): string => template.trim();

export const preparePromptOverridesForSave = (overrides: RepoPromptOverrides) => {
  const next: RepoPromptOverrides = {};

  for (const templateId of Object.keys(overrides)) {
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

/** An append with only blank text adds nothing, so Save removes it. */
export const preparePromptAppendsForSave = (appends: RepoPromptAppends): RepoPromptAppends =>
  Object.fromEntries(
    Object.entries(appends).flatMap(([key, append]) => {
      const text = append.text.trim();
      return text ? [[key, { text, enabled: append.enabled }] as const] : [];
    }),
  );
