import type { AgentPromptTemplateId, RepoPromptOverrides } from "@openducktor/contracts";

export type PromptInheritedPreview = {
  sourceLabel: string;
  template: string;
};

export const buildInheritedPromptPreview = (
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
