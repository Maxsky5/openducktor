import type {
  AgentPromptTemplateId,
  GlobalGitConfig,
  RepoConfig,
  RepoPromptOverrides,
  SettingsSnapshot,
} from "@openducktor/contracts";
import { DEFAULT_BRANCH_PREFIX } from "@/components/features/settings/settings-model";
import { normalizeTargetBranch } from "@/lib/target-branch";
import { DEFAULT_RUNTIME_KIND } from "@/state/agent-runtime-registry";

const trimNonEmpty = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

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

const normalizeAgentDefaultForSave = (
  entry: RepoConfig["agentDefaults"]["spec"],
): RepoConfig["agentDefaults"]["spec"] => {
  if (!entry) {
    return undefined;
  }

  const providerId = trimNonEmpty(entry.providerId);
  const modelId = trimNonEmpty(entry.modelId);
  if (!providerId || !modelId) {
    return undefined;
  }

  const variant = trimNonEmpty(entry.variant ?? "");
  const profileId = trimNonEmpty(entry.profileId ?? "");

  return {
    runtimeKind: entry.runtimeKind,
    providerId,
    modelId,
    ...(variant ? { variant } : {}),
    ...(profileId ? { profileId } : {}),
  };
};

export const normalizeRepoConfigForSave = (repo: RepoConfig): RepoConfig => {
  const spec = normalizeAgentDefaultForSave(repo.agentDefaults.spec);
  const planner = normalizeAgentDefaultForSave(repo.agentDefaults.planner);
  const build = normalizeAgentDefaultForSave(repo.agentDefaults.build);
  const qa = normalizeAgentDefaultForSave(repo.agentDefaults.qa);

  return {
    defaultRuntimeKind: repo.defaultRuntimeKind ?? DEFAULT_RUNTIME_KIND,
    worktreeBasePath: trimNonEmpty(repo.worktreeBasePath ?? "") ?? undefined,
    branchPrefix: trimNonEmpty(repo.branchPrefix) ?? DEFAULT_BRANCH_PREFIX,
    defaultTargetBranch: normalizeTargetBranch(repo.defaultTargetBranch),
    git: repo.git,
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

export const normalizeGlobalGitConfigForSave = (git: GlobalGitConfig): GlobalGitConfig => ({
  defaultMergeMethod: git.defaultMergeMethod,
});

export const normalizeSnapshotForSave = (snapshot: SettingsSnapshot): SettingsSnapshot => {
  const repos = Object.fromEntries(
    Object.entries(snapshot.repos).map(([repoPath, repoConfig]) => [
      repoPath,
      normalizeRepoConfigForSave(repoConfig),
    ]),
  );

  return {
    git: normalizeGlobalGitConfigForSave(snapshot.git),
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
