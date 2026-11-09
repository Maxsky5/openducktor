import type { SettingsRepoConfig } from "@openducktor/contracts";
import { DEFAULT_BRANCH_PREFIX } from "@openducktor/contracts";
import { prepareModelDefaultsForSave } from "@openducktor/frontend-core/lib/repo-agent-defaults";
import { normalizeTargetBranch } from "@openducktor/frontend-core/lib/target-branch";
import { dropBlankLines } from "@/state/read-models/settings-read-model";
import { preparePromptAppendsForSave, preparePromptOverridesForSave } from "./prompt-layers";

const trimmedNonEmpty = (value: string): string | null => {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export const prepareRepoConfigForSave = (repo: SettingsRepoConfig): SettingsRepoConfig => {
  // Keep every field that needs no normalization, such as `git` and `actions`.
  // The action dialog trims and checks each action, so the draft holds only valid actions.
  return {
    ...repo,
    workspaceName: repo.workspaceName.trim(),
    abbreviation: trimmedNonEmpty(repo.abbreviation ?? "") ?? undefined,
    tileColor: trimmedNonEmpty(repo.tileColor ?? "") ?? undefined,
    repoPath: repo.repoPath.trim(),
    ...prepareModelDefaultsForSave(repo),
    worktreeBasePath: trimmedNonEmpty(repo.worktreeBasePath ?? "") ?? undefined,
    branchPrefix: trimmedNonEmpty(repo.branchPrefix) ?? DEFAULT_BRANCH_PREFIX,
    defaultTargetBranch: normalizeTargetBranch(repo.defaultTargetBranch),
    hooks: { beforeWorktreeRemoval: dropBlankLines(repo.hooks.beforeWorktreeRemoval) },
    worktreeCopyPaths: dropBlankLines(repo.worktreeCopyPaths),
    promptOverrides: preparePromptOverridesForSave(repo.promptOverrides),
    promptAppends: preparePromptAppendsForSave(repo.promptAppends),
  };
};
