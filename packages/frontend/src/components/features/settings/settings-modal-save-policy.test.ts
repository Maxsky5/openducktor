import { describe, expect, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import {
  buildPromptValidationSaveError,
  buildRepoScriptValidationSaveError,
  buildReusablePromptValidationSaveError,
  buildRuntimeAvailabilitySaveError,
  hasAnyDirtySections,
  hasSameSaveReadyGlobalGitConfig,
  isGlobalGitOnlySave,
} from "./settings-modal-save-policy";
import { EMPTY_DIRTY_SECTIONS } from "./use-settings-modal-dirty-state";

const createSnapshot = (): SettingsSnapshot => createSettingsSnapshotFixture();

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

  test("compares save-ready global git configs by persisted fields", () => {
    expect(
      hasSameSaveReadyGlobalGitConfig(createSnapshot(), {
        defaultMergeMethod: "merge_commit",
      }),
    ).toBe(true);
    expect(
      hasSameSaveReadyGlobalGitConfig(createSnapshot(), {
        defaultMergeMethod: "squash",
      }),
    ).toBe(false);
    expect(
      hasSameSaveReadyGlobalGitConfig(null, {
        defaultMergeMethod: "merge_commit",
      }),
    ).toBe(false);
  });

  test("builds the prompt and repo validation save errors", () => {
    expect(buildPromptValidationSaveError(1)).toBe("Fix 1 prompt placeholder error before saving.");
    expect(buildPromptValidationSaveError(2)).toBe(
      "Fix 2 prompt placeholder errors before saving.",
    );
    expect(buildReusablePromptValidationSaveError(1)).toBe(
      "Fix 1 reusable prompt field error before saving.",
    );
    expect(buildRuntimeAvailabilitySaveError(2)).toBe(
      "Fix 2 disabled runtime selections before saving.",
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
