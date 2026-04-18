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
  theme: "light",
  git: {
    defaultMergeMethod: "merge_commit",
  },
  chat: {
    showThinkingMessages: false,
  },
  kanban: {
    doneVisibleDays: 1,
  },
  autopilot: {
    rules: [],
  },
  globalPromptOverrides: {
    "system.scenario.spec_initial": {
      template: "invalid {{task.bad}}",
      baseVersion: 1,
      enabled: true,
    },
  },
  workspaces: {
    "repo-a": {
      workspaceId: "repo-a",
      workspaceName: "Repo A",
      repoPath: "/repo-a",
      defaultRuntimeKind: "opencode",
      worktreeBasePath: "/tmp/a",
      branchPrefix: "obp",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        providers: {},
      },
      trustedHooks: false,
      hooks: { preStart: [], postComplete: [] },
      devServers: [],
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
    "repo-b": {
      workspaceId: "repo-b",
      workspaceName: "Repo B",
      repoPath: "/repo-b",
      defaultRuntimeKind: "opencode",
      worktreeBasePath: "/tmp/b",
      branchPrefix: "obp",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        providers: {},
      },
      trustedHooks: false,
      hooks: { preStart: [], postComplete: [] },
      devServers: [],
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
      selectedWorkspaceId: null,
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
      chat: 0,
      kanban: 0,
      autopilot: 0,
    });

    await harness.unmount();
  });

  test("derives global and repo validation counts with tab-level aggregation", async () => {
    const harness = createHookHarness({
      snapshotDraft: createSnapshot(),
      selectedWorkspaceId: "repo-a",
    });

    await harness.mount();
    const latest = harness.getLatest();

    expect(latest.hasPromptValidationErrors).toBe(true);
    expect(latest.promptValidationState.globalErrorCount).toBe(1);
    expect(latest.promptValidationState.repoErrorCountByWorkspaceId["repo-a"]).toBe(1);
    expect(latest.promptValidationState.totalErrorCount).toBe(2);
    expect(latest.globalPromptRoleTabErrorCounts.spec).toBe(1);
    expect(latest.selectedRepoPromptRoleTabErrorCounts.build).toBe(1);
    expect(latest.settingsSectionErrorCountById).toEqual({
      general: 0,
      git: 0,
      repositories: 1,
      prompts: 1,
      chat: 0,
      kanban: 0,
      autopilot: 0,
    });
    expect(latest.selectedRepoPromptValidationErrors["kickoff.build_implementation_start"]).toBe(
      "Unsupported placeholder: {{unknown.value}}.",
    );

    await harness.unmount();
  });

  test("includes required-placeholder validation errors in the aggregated counts", async () => {
    const snapshot = createSnapshot();
    snapshot.globalPromptOverrides = {
      "kickoff.build_after_human_request_changes": {
        template: "Review {{task.id}} before editing.",
        baseVersion: 3,
        enabled: true,
      },
    };

    const harness = createHookHarness({
      snapshotDraft: snapshot,
      selectedWorkspaceId: "repo-a",
    });

    await harness.mount();
    const latest = harness.getLatest();

    expect(latest.hasPromptValidationErrors).toBe(true);
    expect(
      latest.promptValidationState.globalErrors["kickoff.build_after_human_request_changes"],
    ).toBe("Missing required placeholder: {{humanFeedback}}.");
    expect(latest.promptValidationState.globalErrorCount).toBe(1);

    await harness.unmount();
  });
});
