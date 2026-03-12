import { describe, expect, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { useSettingsModalPromptValidation } from "./use-settings-modal-prompt-validation";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useSettingsModalPromptValidation>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useSettingsModalPromptValidation, initialProps);

const createSnapshot = (): SettingsSnapshot => ({
  git: {
    defaultMergeMethod: "merge_commit",
  },
  globalPromptOverrides: {
    "system.scenario.spec_initial": {
      template: "invalid {{task.bad}}",
      baseVersion: 1,
      enabled: true,
    },
  },
  repos: {
    "/repo-a": {
      defaultRuntimeKind: "opencode",
      worktreeBasePath: "/tmp/a",
      branchPrefix: "obp",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        providers: {},
      },
      trustedHooks: false,
      hooks: { preStart: [], postComplete: [] },
      worktreeFileCopies: [],
      promptOverrides: {
        "kickoff.build_implementation_start": {
          template: "invalid {{unknown.value}}",
          baseVersion: 1,
          enabled: true,
        },
      },
      agentDefaults: {},
    },
    "/repo-b": {
      defaultRuntimeKind: "opencode",
      worktreeBasePath: "/tmp/b",
      branchPrefix: "obp",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        providers: {},
      },
      trustedHooks: false,
      hooks: { preStart: [], postComplete: [] },
      worktreeFileCopies: [],
      promptOverrides: {},
      agentDefaults: {},
    },
  },
});

describe("useSettingsModalPromptValidation", () => {
  test("returns empty validation state when snapshot is missing", async () => {
    const harness = createHookHarness({
      snapshotDraft: null,
      selectedRepoPath: null,
    });

    await harness.mount();
    const latest = harness.getLatest();

    expect(latest.hasPromptValidationErrors).toBe(false);
    expect(latest.promptValidationState.totalErrorCount).toBe(0);
    expect(latest.settingsSectionErrorCountById).toEqual({
      general: 0,
      git: 0,
      repositories: 0,
      prompts: 0,
    });

    await harness.unmount();
  });

  test("derives global and repo validation counts with tab-level aggregation", async () => {
    const harness = createHookHarness({
      snapshotDraft: createSnapshot(),
      selectedRepoPath: "/repo-a",
    });

    await harness.mount();
    const latest = harness.getLatest();

    expect(latest.hasPromptValidationErrors).toBe(true);
    expect(latest.promptValidationState.globalErrorCount).toBe(1);
    expect(latest.promptValidationState.repoErrorCountByPath["/repo-a"]).toBe(1);
    expect(latest.promptValidationState.totalErrorCount).toBe(2);
    expect(latest.globalPromptRoleTabErrorCounts.spec).toBe(1);
    expect(latest.selectedRepoPromptRoleTabErrorCounts.build).toBe(1);
    expect(latest.settingsSectionErrorCountById).toEqual({
      general: 0,
      git: 0,
      repositories: 1,
      prompts: 1,
    });
    expect(latest.selectedRepoPromptValidationErrors["kickoff.build_implementation_start"]).toBe(
      "Unsupported placeholder: {{unknown.value}}.",
    );

    await harness.unmount();
  });
});
