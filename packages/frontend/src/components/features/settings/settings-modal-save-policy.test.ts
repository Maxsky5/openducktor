import { describe, expect, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import {
  buildCodexDangerousSettingsSaveError,
  buildPromptValidationSaveError,
  buildRepoScriptValidationSaveError,
  buildReusablePromptValidationSaveError,
  buildRuntimeAvailabilitySaveError,
  getSettingsSaveBlocker,
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

    for (const section of Object.keys(EMPTY_DIRTY_SECTIONS)) {
      if (section === "globalGit") {
        continue;
      }
      expect(
        isGlobalGitOnlySave({
          ...globalGitOnly,
          [section]: true,
        }),
      ).toBe(false);
    }
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
      "Fix 2 runtime executable errors before saving.",
    );
    expect(buildCodexDangerousSettingsSaveError()).toBe(
      "Confirm the Codex safety acknowledgement before saving.",
    );
    expect(
      buildRepoScriptValidationSaveError({
        invalidRepoPathsWithDevServerErrors: ["repo", "repo-two"],
        repoScriptValidationErrorCount: 2,
        selectedWorkspaceId: "repo",
      }),
    ).toBe("Fix 2 dev server field errors in the selected repository, `repo-two` before saving.");
  });

  test("selects the first settings save blocker and its required UI action", () => {
    const blocker = getSettingsSaveBlocker({
      prompt: { hasErrors: true, errorCount: 2 },
      reusablePrompts: { hasErrors: true, errorCount: 3 },
      runtimeRequest: { isPending: true, error: "request failed" },
      runtimeAvailability: { hasErrors: true, errorCount: 1, invalidKind: "claude" },
      hasUnacknowledgedCodexDangerousSettings: true,
      repoScripts: {
        hasErrors: true,
        errorCount: 1,
        invalidRepoPaths: ["repo"],
        selectedWorkspaceId: "repo",
      },
    });

    expect(blocker).toEqual({
      reason: "Fix 2 prompt placeholder errors before saving.",
      runtimeKind: null,
      showRepoScriptErrors: false,
    });
  });

  test("returns runtime focus metadata for an executable blocker", () => {
    const blocker = getSettingsSaveBlocker({
      prompt: { hasErrors: false, errorCount: 0 },
      reusablePrompts: { hasErrors: false, errorCount: 0 },
      runtimeRequest: { isPending: false, error: null },
      runtimeAvailability: { hasErrors: true, errorCount: 1, invalidKind: "codex" },
      hasUnacknowledgedCodexDangerousSettings: false,
      repoScripts: {
        hasErrors: false,
        errorCount: 0,
        invalidRepoPaths: [],
        selectedWorkspaceId: null,
      },
    });

    expect(blocker).toEqual({
      reason: "Fix 1 runtime executable error before saving.",
      runtimeKind: "codex",
      showRepoScriptErrors: false,
    });
  });

  test("returns no blocker for valid settings", () => {
    expect(
      getSettingsSaveBlocker({
        prompt: { hasErrors: false, errorCount: 0 },
        reusablePrompts: { hasErrors: false, errorCount: 0 },
        runtimeRequest: { isPending: false, error: null },
        runtimeAvailability: { hasErrors: false, errorCount: 0, invalidKind: null },
        hasUnacknowledgedCodexDangerousSettings: false,
        repoScripts: {
          hasErrors: false,
          errorCount: 0,
          invalidRepoPaths: [],
          selectedWorkspaceId: null,
        },
      }),
    ).toBeNull();
  });
});
