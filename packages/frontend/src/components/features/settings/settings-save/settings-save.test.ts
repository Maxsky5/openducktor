import { describe, expect, test } from "bun:test";
import {
  settingsSnapshotSaveInputSchema,
  type AgentModelDefault,
  type SettingsRepoConfig,
  type RepoPromptOverrides,
  type WorkspaceSettingsPatch,
} from "@openducktor/contracts";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { prepareAutopilotSettingsForSave } from "./autopilot-settings";
import { preparePromptOverridesForSave } from "./prompt-overrides";
import { prepareRepoConfigForSave } from "./repo-config";
import { prepareSettingsSnapshotForSave } from "./settings-snapshot";
import {
  BUILTIN_PROMPT_OVERRIDE_KEYS,
  builtinWorkflowPromptKey,
} from "@openducktor/workflows/test-support";

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
    [builtinWorkflowPromptKey("messages.spec_start")]: {
      template: " custom kickoff ",
      baseVersion: 0,
      enabled: true,
    },
    [builtinWorkflowPromptKey("messages.qa_review")]: {
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
  test("sends keyed role edits and omits unchanged shared settings", () => {
    const reviewer = { id: "reviewer", name: "Reviewer", systemPrompt: "Review." };
    const retired = { id: "retired", name: "Old role", systemPrompt: "Old." };
    const added = { id: "research", name: "Researcher", systemPrompt: "Research." };
    const baseline = createSettingsSnapshotFixture({ customAgentRoles: [reviewer, retired] });
    const draft = {
      ...baseline,
      customAgentRoles: [{ ...reviewer, name: "Code reviewer" }, added],
    };
    expect(prepareSettingsSnapshotForSave(draft, baseline).customAgentRoles).toEqual({
      create: [added],
      update: { reviewer: { name: "Code reviewer" } },
      remove: ["retired"],
    });
    expect(prepareSettingsSnapshotForSave(baseline, baseline)).toEqual({});
    expect(
      prepareSettingsSnapshotForSave(
        { ...baseline, autopilot: { ...baseline.autopilot, alwaysStartQaReviewsFresh: true } },
        baseline,
      ).autopilot,
    ).toEqual({ alwaysStartQaReviewsFresh: true });
  });

  test("prepares prompt overrides for save", () => {
    const saveReady = preparePromptOverridesForSave({
      [builtinWorkflowPromptKey("messages.spec_start")]: {
        template: "  spec  ",
        baseVersion: 0,
        enabled: undefined,
      },
      [builtinWorkflowPromptKey("messages.qa_review")]: {
        template: "    ",
        baseVersion: 2,
        enabled: true,
      },
    });

    expect(saveReady).toEqual({
      [builtinWorkflowPromptKey("messages.spec_start")]: {
        template: "spec",
        baseVersion: 1,
        enabled: true,
      },
      [builtinWorkflowPromptKey("messages.qa_review")]: {
        template: "",
        baseVersion: 2,
        enabled: true,
      },
    });
  });

  test("preserves shared prompt override entries when preparing save payloads", () => {
    const saveReady = preparePromptOverridesForSave({
      [builtinWorkflowPromptKey("workflow.rules")]: {
        template: "  guards override  ",
        baseVersion: 2,
        enabled: true,
      },
      [builtinWorkflowPromptKey("workflow.tool_rules")]: {
        template: " protocol override ",
        baseVersion: 2,
        enabled: false,
      },
    });

    expect(saveReady).toEqual({
      [builtinWorkflowPromptKey("workflow.rules")]: {
        template: "guards override",
        baseVersion: 2,
        enabled: true,
      },
      [builtinWorkflowPromptKey("workflow.tool_rules")]: {
        template: "protocol override",
        baseVersion: 2,
        enabled: false,
      },
    });
  });

  test("preserves every known prompt override key when preparing save payloads", () => {
    const source: RepoPromptOverrides = Object.fromEntries(
      BUILTIN_PROMPT_OVERRIDE_KEYS.map((templateId, index) => [
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
    expect(saveReadyKeys).toEqual(BUILTIN_PROMPT_OVERRIDE_KEYS.toSorted());

    for (const [index, templateId] of BUILTIN_PROMPT_OVERRIDE_KEYS.entries()) {
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
      [builtinWorkflowPromptKey("messages.spec_start")]: {
        template: "custom kickoff",
        baseVersion: 1,
        enabled: true,
      },
      [builtinWorkflowPromptKey("messages.qa_review")]: {
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

  test.each(["codex", "claude", "opencode"] as const)(
    "saves optional model defaults and only keeps supported profiles for %s",
    (runtimeKind) => {
      const model = {
        runtimeKind,
        providerId: "openai",
        modelId: "model",
        variant: "",
        profileId: " build ",
      };
      const snapshot = createSettingsSnapshotFixture({
        workspaces: {
          "repo-a": createRepoConfig({
            defaultModel: model,
            agentDefaults: { spec: model, planner: model, build: model, qa: model },
          }),
          "repo-b": createRepoConfig({
            workspaceId: "repo-b",
            defaultModel: undefined,
            agentDefaults: {},
          }),
        },
      });
      const baseline = {
        ...snapshot,
        workspaces: Object.fromEntries(
          Object.entries(snapshot.workspaces).map(([id, repo]) => [
            id,
            prepareRepoConfigForSave({ ...repo, defaultModel: undefined, agentDefaults: {} }),
          ]),
        ),
      };
      const saved = settingsSnapshotSaveInputSchema.parse(
        prepareSettingsSnapshotForSave(snapshot, baseline),
      );
      const expected: AgentModelDefault = {
        runtimeKind,
        providerId: "openai",
        modelId: "model",
      };
      if (runtimeKind === "opencode") expected.profileId = "build";
      const expectedDefault: Extract<
        NonNullable<WorkspaceSettingsPatch["defaultModel"]>,
        { type: "set" }
      > = {
        type: "set",
        value: { runtimeKind, providerId: "openai", modelId: "model" },
      };
      if (runtimeKind === "opencode")
        expectedDefault.value.profileId = { type: "set", value: "build" };
      expect(saved.workspaces?.["repo-a"]?.defaultModel).toEqual(expectedDefault);
      expect(Object.values(saved.workspaces?.["repo-a"]?.agentDefaults?.create ?? {})).toEqual([
        expected,
        expected,
        expected,
        expected,
      ]);
      expect(saved.workspaces?.["repo-b"]?.defaultModel).toBeUndefined();
      expect(
        Object.values(saved.workspaces?.["repo-b"]?.agentDefaults?.create ?? {}).filter(Boolean),
      ).toEqual([]);
    },
  );

  test("keeps every workspace field that needs no normalization", () => {
    const repo = createRepoConfig({
      abbreviation: "RA",
      tileColor: "#f08c00",
      git: { provider: { id: "github", enabled: true, autoDetected: false } },
    });
    // SAFETY: The extra field stands for a future workspace field that the save step does not know.
    const withUnknownField = { ...repo, futureField: { kept: true } } as SettingsRepoConfig;

    const saveReady = prepareRepoConfigForSave(withUnknownField);

    expect(Object.keys(saveReady).toSorted()).toEqual(Object.keys(withUnknownField).toSorted());
    expect(saveReady).toMatchObject({
      git: repo.git,
      actions: repo.actions,
      futureField: { kept: true },
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
      "spec agent default runtime kind is required when provider and model are configured.",
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

  test("deduplicates Autopilot actions and keeps each workflow's saved rules", () => {
    const rules = [
      {
        workflowId: "other",
        eventId: "taskProgressedToSpecReady",
        actionIds: ["startQa", "startQa"],
      },
      {
        workflowId: "openducktor-research-plan-implement",
        eventId: "taskProgressedToSpecReady",
        actionIds: ["startPlanner", "startPlanner"],
      },
      {
        workflowId: "openducktor-research-plan-implement",
        eventId: "taskProgressedToHumanReview",
        actionIds: [],
      },
    ];
    expect(prepareAutopilotSettingsForSave({ alwaysStartQaReviewsFresh: true, rules })).toEqual({
      alwaysStartQaReviewsFresh: true,
      rules: [
        { workflowId: "other", eventId: "taskProgressedToSpecReady", actionIds: ["startQa"] },
        {
          workflowId: "openducktor-research-plan-implement",
          eventId: "taskProgressedToSpecReady",
          actionIds: ["startPlanner"],
        },
        {
          workflowId: "openducktor-research-plan-implement",
          eventId: "taskProgressedToHumanReview",
          actionIds: [],
        },
      ],
    });
  });

  test("normalizes empty hook commands to empty arrays", () => {
    const saveReady = prepareRepoConfigForSave({
      ...createRepoConfig(),
      hooks: { postComplete: ["   ", ""] },
    });

    expect(saveReady.hooks).toEqual({ postComplete: [] });
  });

  test("normalizes changed editor values into sparse workspace and global edits", () => {
    const repo = prepareRepoConfigForSave(createRepoConfig());
    const baseline = createSettingsSnapshotFixture({ workspaces: { "repo-a": repo } });
    const draft = {
      ...baseline,
      chat: { ...baseline.chat, showThinkingMessages: true },
      reusablePrompts: [
        {
          id: " prompt-1 ",
          name: " review ",
          description: " Review context ",
          content: " Review this. ",
        },
      ],
      workspaces: { "repo-a": { ...repo, hooks: { postComplete: [" bun test ", ""] } } },
      globalPromptOverrides: {
        [builtinWorkflowPromptKey("messages.spec_start")]: {
          template: " global ",
          baseVersion: 2,
          enabled: false,
        },
      },
    };
    const input = prepareSettingsSnapshotForSave(draft, baseline);
    expect(input.workspaces?.["repo-a"]).toEqual({
      expectedRepoPath: "/repo-a",
      hooks: { postComplete: ["bun test"] },
    });
    expect(input.global?.chat).toEqual({ showThinkingMessages: true });
    expect(input.global?.reusablePrompts).toEqual([
      { id: "prompt-1", name: "review", description: "Review context", content: "Review this." },
    ]);
    expect(input.global?.globalPromptOverrides).toEqual({
      create: {
        [builtinWorkflowPromptKey("messages.spec_start")]: {
          template: "global",
          baseVersion: 2,
          enabled: false,
        },
      },
    });
    expect(input.global?.kanban).toBeUndefined();
    expect(input).not.toHaveProperty("theme");
    expect(input).not.toHaveProperty("agentModelFavorites");
  });
});
