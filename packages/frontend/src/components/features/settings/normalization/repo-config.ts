import type { RepoConfig } from "@openducktor/contracts";
import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { normalizeRepoScripts } from "@/components/features/settings/settings-model";
import { normalizeRepoAgentDefaultForSave } from "@/lib/repo-agent-defaults";
import { normalizeTargetBranch } from "@/lib/target-branch";
import { normalizePromptOverridesForSave } from "./prompt-overrides";

const trimNonEmpty = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const normalizeRepoConfigForSave = (repo: RepoConfig): RepoConfig => {
  const spec = normalizeRepoAgentDefaultForSave("spec", repo.agentDefaults.spec);
  const planner = normalizeRepoAgentDefaultForSave("planner", repo.agentDefaults.planner);
  const build = normalizeRepoAgentDefaultForSave("build", repo.agentDefaults.build);
  const qa = normalizeRepoAgentDefaultForSave("qa", repo.agentDefaults.qa);
  const { hooks, devServers } = normalizeRepoScripts({
    hooks: repo.hooks,
    devServers: repo.devServers ?? [],
  });

  return {
    workspaceId: repo.workspaceId,
    workspaceName: repo.workspaceName.trim(),
    repoPath: repo.repoPath.trim(),
    defaultRuntimeKind: repo.defaultRuntimeKind,
    worktreeBasePath: trimNonEmpty(repo.worktreeBasePath ?? "") ?? undefined,
    branchPrefix: trimNonEmpty(repo.branchPrefix) ?? DEFAULT_BRANCH_PREFIX,
    defaultTargetBranch: normalizeTargetBranch(repo.defaultTargetBranch),
    git: repo.git,
    hooks,
    devServers,
    worktreeCopyPaths: repo.worktreeCopyPaths.map((entry) => entry.trim()).filter(Boolean),
    promptOverrides: normalizePromptOverridesForSave(repo.promptOverrides),
    agentDefaults: {
      ...(spec ? { spec } : {}),
      ...(planner ? { planner } : {}),
      ...(build ? { build } : {}),
      ...(qa ? { qa } : {}),
    },
  };
};
