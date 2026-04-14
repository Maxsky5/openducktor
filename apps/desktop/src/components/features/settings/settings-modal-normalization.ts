import type {
  AgentPromptTemplateId,
  AutopilotActionId,
  AutopilotEventId,
  AutopilotSettings,
  GlobalGitConfig,
  RepoConfig,
  RepoPromptOverrides,
  SettingsSnapshot,
} from "@openducktor/contracts";
import {
  AUTOPILOT_EVENT_IDS,
  createDefaultAutopilotSettings,
  DEFAULT_BRANCH_PREFIX,
} from "@openducktor/contracts";
import { normalizeRepoScriptsWithTrust } from "@/components/features/settings/settings-model";
import {
  normalizeRepoAgentDefaultForSave,
  normalizeRepoDefaultRuntimeKindForSave,
} from "@/lib/repo-agent-defaults";
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

export const normalizeRepoConfigForSave = (repo: RepoConfig): RepoConfig => {
  const spec = normalizeRepoAgentDefaultForSave("spec", repo.agentDefaults.spec);
  const planner = normalizeRepoAgentDefaultForSave("planner", repo.agentDefaults.planner);
  const build = normalizeRepoAgentDefaultForSave("build", repo.agentDefaults.build);
  const qa = normalizeRepoAgentDefaultForSave("qa", repo.agentDefaults.qa);
  const { hooks, devServers, trustedHooks } = normalizeRepoScriptsWithTrust(
    {
      hooks: repo.hooks,
      devServers: repo.devServers ?? [],
    },
    repo.trustedHooks,
  );

  return {
    defaultRuntimeKind: normalizeRepoDefaultRuntimeKindForSave(
      repo.defaultRuntimeKind,
      DEFAULT_RUNTIME_KIND,
    ),
    worktreeBasePath: trimNonEmpty(repo.worktreeBasePath ?? "") ?? undefined,
    branchPrefix: trimNonEmpty(repo.branchPrefix) ?? DEFAULT_BRANCH_PREFIX,
    defaultTargetBranch: normalizeTargetBranch(repo.defaultTargetBranch),
    git: repo.git,
    trustedHooks,
    trustedHooksFingerprint: trustedHooks ? repo.trustedHooksFingerprint : undefined,
    hooks,
    devServers,
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

export const normalizeAutopilotSettingsForSave = (
  autopilot: AutopilotSettings,
): AutopilotSettings => {
  const defaultSettings = createDefaultAutopilotSettings();
  const rulesByEvent = new Map<AutopilotEventId, AutopilotSettings["rules"][number]>(
    autopilot.rules.map((rule) => [rule.eventId, rule]),
  );

  return {
    rules: AUTOPILOT_EVENT_IDS.map((eventId) => {
      const explicitRule = rulesByEvent.get(eventId);
      const actionIds = (explicitRule?.actionIds ?? []).filter(
        (actionId, index, list) => list.indexOf(actionId) === index,
      ) as AutopilotActionId[];

      return {
        eventId,
        actionIds: explicitRule
          ? actionIds
          : (defaultSettings.rules.find((rule) => rule.eventId === eventId)?.actionIds ?? []),
      };
    }),
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
    theme: snapshot.theme,
    git: normalizeGlobalGitConfigForSave(snapshot.git),
    chat: snapshot.chat,
    kanban: snapshot.kanban,
    autopilot: normalizeAutopilotSettingsForSave(snapshot.autopilot),
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
