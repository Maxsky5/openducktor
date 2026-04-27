import { describe, expect, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import {
  buildPromptValidationSaveError,
  buildRepoScriptValidationSaveError,
  hasAnyDirtySections,
  hasSameNormalizedGlobalGitConfig,
  isGlobalGitOnlySave,
} from "./settings-modal-save-policy";
import { EMPTY_DIRTY_SECTIONS } from "./use-settings-modal-dirty-state";

const createSnapshot = (): SettingsSnapshot => ({
  theme: "light",
  git: {
    defaultMergeMethod: "merge_commit",
  },
  chat: {
    showThinkingMessages: false,
  },
  kanban: {
    doneVisibleDays: 1,
    emptyColumnDisplay: "show",
  },
  autopilot: {
    rules: [],
  },
  globalPromptOverrides: {},
  workspaces: {},
});

describe("settings-modal-save-policy", () => {
  test("derives dirty and global-git-only save modes", () => {
    expect(hasAnyDirtySections(EMPTY_DIRTY_SECTIONS)).toBe(false);
    expect(isGlobalGitOnlySave(EMPTY_DIRTY_SECTIONS)).toBe(false);

    const globalGitOnly = {
      ...EMPTY_DIRTY_SECTIONS,
      globalGit: true,
    };
    expect(hasAnyDirtySections(globalGitOnly)).toBe(true);
    expect(isGlobalGitOnlySave(globalGitOnly)).toBe(true);

    expect(
      isGlobalGitOnlySave({
        ...globalGitOnly,
        chat: true,
      }),
    ).toBe(false);
  });

  test("compares normalized global git configs by persisted fields", () => {
    expect(
      hasSameNormalizedGlobalGitConfig(createSnapshot(), {
        defaultMergeMethod: "merge_commit",
      }),
    ).toBe(true);
    expect(
      hasSameNormalizedGlobalGitConfig(createSnapshot(), {
        defaultMergeMethod: "squash",
      }),
    ).toBe(false);
    expect(
      hasSameNormalizedGlobalGitConfig(null, {
        defaultMergeMethod: "merge_commit",
      }),
    ).toBe(false);
  });

  test("builds the prompt and repo validation save errors", () => {
    expect(buildPromptValidationSaveError(1)).toBe("Fix 1 prompt placeholder error before saving.");
    expect(buildPromptValidationSaveError(2)).toBe(
      "Fix 2 prompt placeholder errors before saving.",
    );
    expect(
      buildRepoScriptValidationSaveError({
        invalidRepoPathsWithDevServerErrors: ["repo", "repo-two"],
        repoScriptValidationErrorCount: 2,
        selectedWorkspaceId: "repo",
      }),
    ).toBe("Fix 2 dev server field errors in the selected repository, `repo-two` before saving.");
  });
});
