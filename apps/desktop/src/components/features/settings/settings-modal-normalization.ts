import type {
  AgentPromptTemplateId,
  RepoConfig,
  RepoPromptOverrides,
  SettingsSnapshot,
} from "@openducktor/contracts";
import { agentPromptTemplateIdValues } from "@openducktor/contracts";
import { DEFAULT_BRANCH_PREFIX } from "@/components/features/settings/settings-model";
import { normalizeCanonicalTargetBranch } from "@/lib/target-branch";

const trimNonEmpty = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizePromptOverridesForSave = (
  overrides: RepoPromptOverrides,
): RepoPromptOverrides => {
  const next: RepoPromptOverrides = {};

  for (const templateId of agentPromptTemplateIdValues) {
    const entry = overrides[templateId];
    if (!entry) {
      continue;
    }

    const template = trimNonEmpty(entry.template);
    if (!template) {
      continue;
    }

    next[templateId] = {
      template,
      baseVersion: Math.max(1, Math.trunc(entry.baseVersion || 1)),
      enabled: entry.enabled !== false,
    };
  }

  return next;
};

const normalizeAgentDefaultForSave = (
  entry:
    | {
        providerId: string;
        modelId: string;
        variant?: string | undefined;
        opencodeAgent?: string | undefined;
      }
    | undefined,
) => {
  if (!entry) {
    return undefined;
  }

  const providerId = trimNonEmpty(entry.providerId);
  const modelId = trimNonEmpty(entry.modelId);
  if (!providerId || !modelId) {
    return undefined;
  }

  const variant = trimNonEmpty(entry.variant ?? "");
  const opencodeAgent = trimNonEmpty(entry.opencodeAgent ?? "");

  return {
    providerId,
    modelId,
    ...(variant ? { variant } : {}),
    ...(opencodeAgent ? { opencodeAgent } : {}),
  };
};

export const normalizeRepoConfigForSave = (repo: RepoConfig): RepoConfig => {
  const spec = normalizeAgentDefaultForSave(repo.agentDefaults.spec);
  const planner = normalizeAgentDefaultForSave(repo.agentDefaults.planner);
  const build = normalizeAgentDefaultForSave(repo.agentDefaults.build);
  const qa = normalizeAgentDefaultForSave(repo.agentDefaults.qa);

  return {
    worktreeBasePath: trimNonEmpty(repo.worktreeBasePath ?? "") ?? undefined,
    branchPrefix: trimNonEmpty(repo.branchPrefix) ?? DEFAULT_BRANCH_PREFIX,
    defaultTargetBranch: normalizeCanonicalTargetBranch(repo.defaultTargetBranch),
    trustedHooks: repo.trustedHooks,
    trustedHooksFingerprint: repo.trustedHooksFingerprint,
    hooks: {
      preStart: repo.hooks.preStart.map((entry) => entry.trim()).filter(Boolean),
      postComplete: repo.hooks.postComplete.map((entry) => entry.trim()).filter(Boolean),
    },
    worktreeFileCopies: repo.worktreeFileCopies.map((entry) => entry.trim()).filter(Boolean),
    promptOverrides: normalizePromptOverridesForSave(repo.promptOverrides),
    agentDefaults: {
      ...(spec ? { spec } : {}),
      ...(planner ? { planner } : {}),
      ...(build ? { build } : {}),
      ...(qa ? { qa } : {}),
    },
  };
};

export const normalizeSnapshotForSave = (snapshot: SettingsSnapshot): SettingsSnapshot => {
  const repos = Object.fromEntries(
    Object.entries(snapshot.repos).map(([repoPath, repoConfig]) => [
      repoPath,
      normalizeRepoConfigForSave(repoConfig),
    ]),
  );

  return {
    repos,
    globalPromptOverrides: normalizePromptOverridesForSave(snapshot.globalPromptOverrides),
  };
};

export const pickInitialRepoPath = (
  snapshot: SettingsSnapshot,
  activeRepo: string | null,
): string | null => {
  const repoPaths = Object.keys(snapshot.repos).sort();
  if (activeRepo && snapshot.repos[activeRepo]) {
    return activeRepo;
  }
  return repoPaths[0] ?? null;
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
