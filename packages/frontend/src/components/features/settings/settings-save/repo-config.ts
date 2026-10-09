import type { SettingsRepoConfig } from "@openducktor/contracts";
import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { prepareModelDefaultsForSave } from "@/lib/repo-agent-defaults";
import { normalizeTargetBranch } from "@/lib/target-branch";
import { dropBlankLines } from "@/state/read-models/settings-read-model";
import { preparePromptOverridesForSave } from "./prompt-overrides";

const trimmedNonEmpty = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const prepareRepoConfigForSave = (repo: SettingsRepoConfig): SettingsRepoConfig => {
  return {
    workspaceId: repo.workspaceId,
    workspaceName: repo.workspaceName.trim(),
    abbreviation: trimmedNonEmpty(repo.abbreviation ?? "") ?? undefined,
    tileColor: trimmedNonEmpty(repo.tileColor ?? "") ?? undefined,
    repoPath: repo.repoPath.trim(),
    ...prepareModelDefaultsForSave(repo),
    worktreeBasePath: trimmedNonEmpty(repo.worktreeBasePath ?? "") ?? undefined,
    branchPrefix: trimmedNonEmpty(repo.branchPrefix) ?? DEFAULT_BRANCH_PREFIX,
    defaultTargetBranch: normalizeTargetBranch(repo.defaultTargetBranch),
    git: repo.git,
    hooks: { postComplete: dropBlankLines(repo.hooks.postComplete) },
    // The action dialog trims and checks each action, so the draft holds only valid actions.
    actions: repo.actions,
    worktreeCopyPaths: dropBlankLines(repo.worktreeCopyPaths),
    promptOverrides: preparePromptOverridesForSave(repo.promptOverrides),
  };
};
