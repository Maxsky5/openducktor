import { describe, expect, test } from "bun:test";
import {
  agentPromptTemplateIdValues,
  type SettingsRepoConfig,
  type RepoPromptOverrides,
} from "@openducktor/contracts";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { prepareAutopilotSettingsForSave } from "./autopilot-settings";
import { preparePromptOverridesForSave } from "./prompt-overrides";
import { prepareRepoConfigForSave } from "./repo-config";
import { prepareSettingsSnapshotForSave } from "./settings-snapshot";

const createRepoConfig = (overrides: Partial<SettingsRepoConfig> = {}): SettingsRepoConfig => ({
  workspaceId: "repo-a",
  workspaceName: "Repo A",
  repoPath: "/repo-a",
  defaultModel: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
    variant: " high ",
    profileId: " build ",
  },
  worktreeBasePath: "  /tmp/worktrees  ",
  branchPrefix: "  ",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: {
    postComplete: [" npm test ", ""],
  },
  actions: {
    items: [
      {
        id: "test",
        icon: "test",
        name: "Test",
        command: "bun test",
        runOnWorktreeCreate: true,
        waitBeforeAgentStart: false,
      },
    ],
    defaultActionId: "test",
  },
  worktreeCopyPaths: [" .env ", " "],
  promptOverrides: {
    "kickoff.spec_initial": {
      template: " custom kickoff ",
      baseVersion: 0,
      enabled: true,
    },
    "kickoff.qa_review": {
      template: "   ",
      baseVersion: 2,
      enabled: true,
    },
  },
  agentDefaults: {
    spec: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec",
    },
    planner: {
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "",
      variant: "high",
      profileId: "planner",
    },
    build: undefined,
    qa: undefined,
  },
  ...overrides,
});

describe("settings save transforms", () => {
  test("only replaces custom roles when the role section was edited", () => {
    const snapshot = createSettingsSnapshotFixture({
      customAgentRoles: [{ id: "reviewer", name: "Reviewer", systemPrompt: "  Review code.\n" }],
    });
    expect(prepareSettingsSnapshotForSave(snapshot)).not.toHaveProperty("customAgentRoles");
    expect(
      prepareSettingsSnapshotForSave(snapshot, { saveCustomAgentRoles: true }).customAgentRoles,
    ).toEqual(snapshot.customAgentRoles);
    expect(
      prepareSettingsSnapshotForSave(
        { ...snapshot, customAgentRoles: [] },
        { saveCustomAgentRoles: true },
      ).customAgentRoles,
    ).toEqual([]);
  });

  test("prepares prompt overrides for save", () => {
    const saveReady = preparePromptOverridesForSave({
      "kickoff.spec_initial": {
        template: "  spec  ",
        baseVersion: 0,
        enabled: undefined,
      },
      "kickoff.qa_review": {
        template: "    ",
        baseVersion: 2,
        enabled: true,
      },
    });

    expect(saveReady).toEqual({
      "kickoff.spec_initial": {
        template: "spec",
        baseVersion: 1,
        enabled: true,
      },
      "kickoff.qa_review": {
        template: "",
        baseVersion: 2,
        enabled: true,
      },
    });
  });

  test("preserves shared prompt override entries when preparing save payloads", () => {
    const saveReady = preparePromptOverridesForSave({
      "system.shared.workflow_guards": {
        template: "  guards override  ",
        baseVersion: 2,
        enabled: true,
      },
      "system.shared.tool_protocol": {
        template: " protocol override ",
        baseVersion: 2,
        enabled: false,
      },
    });

    expect(saveReady).toEqual({
      "system.shared.workflow_guards": {
        template: "guards override",
        baseVersion: 2,
        enabled: true,
      },
      "system.shared.tool_protocol": {
        template: "protocol override",
        baseVersion: 2,
        enabled: false,
      },
    });
  });

  test("preserves every known prompt override key when preparing save payloads", () => {
    const source: RepoPromptOverrides = Object.fromEntries(
      agentPromptTemplateIdValues.map((templateId, index) => [
        templateId,
        {
          template: ` ${templateId} template `,
          baseVersion: index + 1,
          enabled: index % 2 === 0,
        },
      ]),
    );

    const saveReady = preparePromptOverridesForSave(source);
    const saveReadyKeys = Object.keys(saveReady).sort();
    expect(saveReadyKeys).toEqual(agentPromptTemplateIdValues.toSorted());

    for (const [index, templateId] of agentPromptTemplateIdValues.entries()) {
      const entry = saveReady[templateId];
      expect(entry).toEqual({
        template: `${templateId} template`,
        baseVersion: index + 1,
        enabled: index % 2 === 0,
      });
    }
  });

  test("prepares repo config and removes incomplete agent defaults", () => {
    const saveReady = prepareRepoConfigForSave(createRepoConfig());

    expect(saveReady.defaultModel).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "build",
    });
    expect(saveReady.branchPrefix).toBe("odt");
    expect(saveReady.defaultTargetBranch).toEqual({ remote: "origin", branch: "main" });
    expect(saveReady.worktreeBasePath).toBe("/tmp/worktrees");
    expect(saveReady.hooks).toEqual({ postComplete: ["npm test"] });
    expect(saveReady.actions).toEqual(createRepoConfig().actions);
    expect(saveReady.worktreeCopyPaths).toEqual([".env"]);
    expect(saveReady.promptOverrides).toEqual({
      "kickoff.spec_initial": {
        template: "custom kickoff",
        baseVersion: 1,
        enabled: true,
      },
      "kickoff.qa_review": {
        template: "",
        baseVersion: 2,
        enabled: true,
      },
    });
    expect(saveReady.agentDefaults).toEqual({
      spec: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "spec",
      },
    });
  });

  test("trims the abbreviation and drops a blank abbreviation and tile color", () => {
    const trimmed = prepareRepoConfigForSave(
      createRepoConfig({ abbreviation: " iOS ", tileColor: "#f08c00" }),
    );
    expect(trimmed.abbreviation).toBe("iOS");
    expect(trimmed.tileColor).toBe("#f08c00");

    const cleared = prepareRepoConfigForSave(createRepoConfig({ abbreviation: "   " }));
    expect(cleared.abbreviation).toBeUndefined();
    expect(cleared.tileColor).toBeUndefined();
  });

  test("rejects configured agent defaults without runtime kind", () => {
    expect(() =>
      prepareRepoConfigForSave({
        ...createRepoConfig(),
        agentDefaults: {
          ...createRepoConfig().agentDefaults,
          // @ts-expect-error This negative test verifies that configured defaults require a runtime kind.
          spec: {
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "spec",
          },
        },
      }),
    ).toThrow(
      "Specification agent default runtime kind is required when provider and model are configured.",
    );
  });

  test("drops a default model without provider or model", () => {
    const saveReady = prepareRepoConfigForSave({
      ...createRepoConfig(),
      defaultModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "   ",
        variant: "",
        profileId: "",
      },
    });

    expect(saveReady.defaultModel).toBeUndefined();
  });

  test("rejects a default model without runtime kind", () => {
    expect(() =>
      prepareRepoConfigForSave({
        ...createRepoConfig(),
        // @ts-expect-error This negative test verifies that a configured Default Model requires a runtime kind.
        defaultModel: {
          providerId: "openai",
          modelId: "gpt-5",
          variant: "",
          profileId: "",
        },
      }),
    ).toThrow("Default Model runtime kind is required when provider and model are configured.");
  });

  test("prepares autopilot settings in canonical event order", () => {
    const saveReady = prepareAutopilotSettingsForSave({
      alwaysStartQaReviewsFresh: true,
      rules: [
        {
          eventId: "taskProgressedToHumanReview",
          actionIds: ["startGeneratePullRequest", "startGeneratePullRequest"],
        },
        {
          eventId: "taskProgressedToSpecReady",
          actionIds: ["startPlanner", "startPlanner"],
        },
      ],
    });

    expect(saveReady.alwaysStartQaReviewsFresh).toBe(true);
    expect(saveReady.rules).toEqual([
      { eventId: "taskProgressedToSpecReady", actionIds: ["startPlanner"] },
      { eventId: "taskProgressedToReadyForDev", actionIds: [] },
      { eventId: "taskProgressedToAiReview", actionIds: [] },
      { eventId: "taskRejectedByQa", actionIds: [] },
      { eventId: "taskProgressedToHumanReview", actionIds: ["startGeneratePullRequest"] },
    ]);
  });

  test("preserves explicit empty autopilot actions for a configured event", () => {
    const saveReady = prepareAutopilotSettingsForSave({
      alwaysStartQaReviewsFresh: false,
      rules: [
        {
          eventId: "taskProgressedToSpecReady",
          actionIds: [],
        },
      ],
    });

    expect(saveReady.rules[0]).toEqual({
      eventId: "taskProgressedToSpecReady",
      actionIds: [],
    });
    expect(saveReady.alwaysStartQaReviewsFresh).toBe(false);
  });

  test("normalizes empty hook commands to empty arrays", () => {
    const saveReady = prepareRepoConfigForSave({
      ...createRepoConfig(),
      hooks: { postComplete: ["   ", ""] },
    });

    expect(saveReady.hooks).toEqual({ postComplete: [] });
  });

  test("normalizes snapshot workspace map and global prompt overrides", () => {
    const snapshot = prepareSettingsSnapshotForSave(
      createSettingsSnapshotFixture({
        agentModelFavorites: [{ runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" }],
        chat: {
          showThinkingMessages: true,
        },
        appearance: {
          horizontalScrollbarVisibility: "hide",
        },
        reusablePrompts: [
          {
            id: " prompt-1 ",
            name: " review ",
            description: " Review context ",
            content: " Review this. ",
          },
        ],
        workspaces: {
          "repo-a": createRepoConfig(),
        },
        globalPromptOverrides: {
          "kickoff.spec_initial": {
            template: " global ",
            baseVersion: 2,
            enabled: false,
          },
        },
      }),
    );

    expect(snapshot.workspaces["repo-a"]?.hooks.postComplete).toEqual(["npm test"]);
    expect("theme" in snapshot).toBe(false);
    expect(snapshot.workspaces["repo-a"]?.actions).toEqual(createRepoConfig().actions);
    expect(snapshot.chat.showThinkingMessages).toBe(true);
    expect(snapshot.reusablePrompts).toEqual([
      {
        id: "prompt-1",
        name: "review",
        description: "Review context",
        content: "Review this.",
      },
    ]);
    expect(snapshot.appearance).toEqual({
      horizontalScrollbarVisibility: "hide",
      sidebarSessionGrouping: "task",
    });
    expect(snapshot.kanban.doneVisibleDays).toBe(1);
    expect(snapshot.agentModelFavorites).toEqual([
      { runtimeKind: "opencode", providerId: "openai", modelId: "gpt-5" },
    ]);
    expect(snapshot.globalPromptOverrides).toEqual({
      "kickoff.spec_initial": {
        template: "global",
        baseVersion: 2,
        enabled: false,
      },
    });
  });
});
