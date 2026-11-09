import { specPlanBuildPromptKey, rolePromptKey } from "@openducktor/workflows/test-support";
import { describe, expect, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "@/pages/agents/agent-studio-test-utils";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { useSettingsModalPromptValidation } from "./use-settings-modal-prompt-validation";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useSettingsModalPromptValidation>[0];

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useSettingsModalPromptValidation, initialProps);

const createSnapshot = (): SettingsSnapshot =>
  createSettingsSnapshotFixture({
    globalPromptOverrides: {
      [rolePromptKey("spec")]: {
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
        worktreeBasePath: "/tmp/a",
        branchPrefix: "obp",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {},
        hooks: { beforeWorktreeRemoval: [] },
        actions: { items: [], defaultActionId: null },
        worktreeCopyPaths: [],
        promptOverrides: {
          [specPlanBuildPromptKey("messages.build_start")]: {
            template: "invalid {{unknown.value}}",
            baseVersion: 1,
            enabled: true,
          },
        },
        promptAppends: {
          [specPlanBuildPromptKey("messages.build_start")]: {
            text: "Compare with {{git.targetBranch}}.",
            enabled: true,
          },
        },
        agentDefaults: {},
      },
      "repo-b": {
        workspaceId: "repo-b",
        workspaceName: "Repo B",
        repoPath: "/repo-b",
        worktreeBasePath: "/tmp/b",
        branchPrefix: "obp",
        defaultTargetBranch: { remote: "origin", branch: "main" },
        git: {},
        hooks: { beforeWorktreeRemoval: [] },
        actions: { items: [], defaultActionId: null },
        worktreeCopyPaths: [],
        promptOverrides: {},
        promptAppends: {},
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
      "remote-access": 0,
      git: 0,
      runtimes: 0,
      repositories: 0,
      prompts: 0,
      "reusable-prompts": 0,
      "custom-agent-roles": 0,
      appearance: 0,
      chat: 0,
      notifications: 0,
      kanban: 0,
      autopilot: 0,
    });

    await harness.unmount();
  });

  test("counts each prompt with errors once and keeps the error of each layer", async () => {
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
    expect(latest.settingsSectionErrorCountById).toEqual({
      general: 0,
      "remote-access": 0,
      git: 0,
      runtimes: 0,
      repositories: 1,
      prompts: 1,
      "reusable-prompts": 0,
      "custom-agent-roles": 0,
      appearance: 0,
      chat: 0,
      notifications: 0,
      kanban: 0,
      autopilot: 0,
    });
    expect(
      latest.selectedRepoPromptValidationErrors[specPlanBuildPromptKey("messages.build_start")],
    ).toEqual({
      override: `Unsupported placeholder: {{unknown.value}}.`,
      append: `This prompt cannot fill {{git.targetBranch}}.`,
    });

    await harness.unmount();
  });

  test("names the place of the first error: global first, then the open repository", async () => {
    const snapshot = createSnapshot();
    const builderKey = specPlanBuildPromptKey("messages.build_start");
    const harness = createHookHarness({ snapshotDraft: snapshot, selectedWorkspaceId: "repo-b" });
    await harness.mount();
    expect(harness.getLatest().promptValidationState.firstErrorPlace).toBe(
      "Spec Instructions (System prompts)",
    );
    await harness.unmount();

    // Without a global error, a repository error names its repository. Repo B, which is open,
    // comes before Repo A.
    const repoOnly: SettingsSnapshot = {
      ...snapshot,
      globalPromptOverrides: {},
      workspaces: {
        ...snapshot.workspaces,
        "repo-b": {
          ...snapshot.workspaces["repo-b"]!,
          promptAppends: { [builderKey]: { text: "Rebase {{git.currentBranch}}.", enabled: true } },
        },
      },
    };
    const repoHarness = createHookHarness({
      snapshotDraft: repoOnly,
      selectedWorkspaceId: "repo-b",
    });
    await repoHarness.mount();
    expect(repoHarness.getLatest().promptValidationState.firstErrorPlace).toBe(
      "Builder Kickoff (Spec, Plan, Build, Repository prompts of Repo B)",
    );
    await repoHarness.unmount();
  });

  test("includes required-placeholder validation errors in the aggregated counts", async () => {
    const snapshot = createSnapshot();
    snapshot.globalPromptOverrides = {
      [specPlanBuildPromptKey("messages.build_requested_changes")]: {
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
      latest.promptValidationState.globalErrors[
        specPlanBuildPromptKey("messages.build_requested_changes")
      ],
    ).toEqual({ override: "Missing required placeholder: {{humanFeedback}}." });
    expect(latest.promptValidationState.globalErrorCount).toBe(1);

    await harness.unmount();
  });
});
