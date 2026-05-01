import { describe, expect, test } from "bun:test";
import {
  type AgentPromptTemplateId,
  agentPromptTemplateIdValues,
  type RepoConfig,
  type RepoPromptOverrides,
} from "@openducktor/contracts";
import {
  normalizeAutopilotSettingsForSave,
  normalizePromptOverridesForSave,
  normalizeRepoConfigForSave,
  normalizeSnapshotForSave,
  pickInitialWorkspaceId,
  resolveInheritedPromptPreview,
} from "./settings-modal-normalization";

const createRepoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo-a",
  workspaceName: "Repo A",
  repoPath: "/repo-a",
  defaultRuntimeKind: "opencode",
  worktreeBasePath: "  /tmp/worktrees  ",
  branchPrefix: "  ",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {
    providers: {},
  },
  hooks: {
    preStart: [" npm ci ", " "],
    postComplete: [" npm test ", ""],
  },
  devServers: [
    {
      id: "frontend",
      name: " Frontend ",
      command: " bun run dev ",
    },
  ],
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

describe("settings-modal-normalization", () => {
  test("normalizes prompt overrides for save", () => {
    const normalized = normalizePromptOverridesForSave({
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

    expect(normalized).toEqual({
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

  test("preserves shared prompt override entries when normalizing for save", () => {
    const normalized = normalizePromptOverridesForSave({
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

    expect(normalized).toEqual({
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

  test("preserves every known prompt override key across normalization", () => {
    const source = Object.fromEntries(
      agentPromptTemplateIdValues.map((templateId, index) => [
        templateId,
        {
          template: ` ${templateId} template `,
          baseVersion: index + 1,
          enabled: index % 2 === 0,
        },
      ]),
    ) as RepoPromptOverrides;

    const normalized = normalizePromptOverridesForSave(source);
    const normalizedKeys = Object.keys(normalized).sort();
    expect(normalizedKeys).toEqual([...agentPromptTemplateIdValues].sort());

    for (const [index, templateId] of agentPromptTemplateIdValues.entries()) {
      const entry = normalized[templateId as AgentPromptTemplateId];
      expect(entry).toEqual({
        template: `${templateId} template`,
        baseVersion: index + 1,
        enabled: index % 2 === 0,
      });
    }
  });

  test("normalizes repo config and removes incomplete agent defaults", () => {
    const normalized = normalizeRepoConfigForSave(createRepoConfig());

    expect(normalized.defaultRuntimeKind).toBe("opencode");
    expect(normalized.branchPrefix).toBe("odt");
    expect(normalized.defaultTargetBranch).toEqual({ remote: "origin", branch: "main" });
    expect(normalized.worktreeBasePath).toBe("/tmp/worktrees");
    expect(normalized.hooks).toEqual({
      preStart: ["npm ci"],
      postComplete: ["npm test"],
    });
    expect(normalized.devServers).toEqual([
      {
        id: "frontend",
        name: "Frontend",
        command: "bun run dev",
      },
    ]);
    expect(normalized.worktreeCopyPaths).toEqual([".env"]);
    expect(normalized.promptOverrides).toEqual({
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
    expect(normalized.agentDefaults).toEqual({
      spec: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "spec",
      },
    });
  });

  test("rejects configured agent defaults without runtime kind", () => {
    expect(() =>
      normalizeRepoConfigForSave({
        ...createRepoConfig(),
        agentDefaults: {
          ...createRepoConfig().agentDefaults,
          spec: {
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "spec",
          } as unknown as RepoConfig["agentDefaults"]["spec"],
        },
      }),
    ).toThrow(
      "Specification agent default runtime kind is required when provider and model are configured.",
    );
  });

  test("normalizes autopilot settings into canonical event order", () => {
    const normalized = normalizeAutopilotSettingsForSave({
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

    expect(normalized.rules).toEqual([
      { eventId: "taskProgressedToSpecReady", actionIds: ["startPlanner"] },
      { eventId: "taskProgressedToReadyForDev", actionIds: [] },
      { eventId: "taskProgressedToAiReview", actionIds: [] },
      { eventId: "taskRejectedByQa", actionIds: [] },
      { eventId: "taskProgressedToHumanReview", actionIds: ["startGeneratePullRequest"] },
    ]);
  });

  test("preserves explicit empty autopilot actions for a configured event", () => {
    const normalized = normalizeAutopilotSettingsForSave({
      rules: [
        {
          eventId: "taskProgressedToSpecReady",
          actionIds: [],
        },
      ],
    });

    expect(normalized.rules[0]).toEqual({
      eventId: "taskProgressedToSpecReady",
      actionIds: [],
    });
  });

  test("normalizes empty hook commands to empty arrays", () => {
    const normalized = normalizeRepoConfigForSave({
      ...createRepoConfig(),
      hooks: {
        preStart: ["   "],
        postComplete: [""],
      },
      devServers: [],
    });

    expect(normalized.hooks).toEqual({
      preStart: [],
      postComplete: [],
    });
  });

  test("normalizes empty dev server rows away", () => {
    const normalized = normalizeRepoConfigForSave({
      ...createRepoConfig(),
      hooks: {
        preStart: [],
        postComplete: [],
      },
      devServers: [{ id: "frontend", name: "Frontend", command: "   " }],
    });

    expect(normalized.devServers).toEqual([]);
  });

  test("rejects blank dev server names when commands remain configured", () => {
    expect(() =>
      normalizeRepoConfigForSave({
        ...createRepoConfig(),
        devServers: [{ id: "frontend", name: "   ", command: "bun run dev" }],
      }),
    ).toThrow("Dev server tab labels cannot be blank");
  });

  test("rejects blank dev server ids when commands remain configured", () => {
    expect(() =>
      normalizeRepoConfigForSave({
        ...createRepoConfig(),
        devServers: [{ id: "   ", name: "Frontend", command: "bun run dev" }],
      }),
    ).toThrow("Dev server id cannot be blank.");
  });

  test("normalizes hook commands when configured", () => {
    const normalized = normalizeRepoConfigForSave({
      ...createRepoConfig(),
      hooks: {
        preStart: [" bun install "],
        postComplete: [],
      },
      devServers: [],
    });

    expect(normalized.hooks).toEqual({
      preStart: ["bun install"],
      postComplete: [],
    });
  });

  test("normalizes snapshot workspace map and global prompt overrides", () => {
    const snapshot = normalizeSnapshotForSave({
      theme: "light",
      git: {
        defaultMergeMethod: "merge_commit",
      },
      chat: {
        showThinkingMessages: true,
      },
      kanban: {
        doneVisibleDays: 1,
        emptyColumnDisplay: "show" as const,
      },
      autopilot: {
        rules: [],
      },
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
    });

    expect(snapshot.workspaces["repo-a"]?.hooks.preStart).toEqual(["npm ci"]);
    expect(snapshot.workspaces["repo-a"]?.devServers).toEqual([
      {
        id: "frontend",
        name: "Frontend",
        command: "bun run dev",
      },
    ]);
    expect(snapshot.chat.showThinkingMessages).toBe(true);
    expect(snapshot.kanban.doneVisibleDays).toBe(1);
    expect(snapshot.globalPromptOverrides).toEqual({
      "kickoff.spec_initial": {
        template: "global",
        baseVersion: 2,
        enabled: false,
      },
    });
    expect(snapshot.theme).toBe("light");
  });

  test("selects initial repo using active repo when available", () => {
    const snapshot = {
      theme: "light" as const,
      git: {
        defaultMergeMethod: "merge_commit" as const,
      },
      chat: {
        showThinkingMessages: false,
      },
      kanban: {
        doneVisibleDays: 1,
        emptyColumnDisplay: "show" as const,
      },
      autopilot: {
        rules: [],
      },
      workspaces: {
        "repo-b": createRepoConfig({
          workspaceId: "repo-b",
          workspaceName: "Repo B",
          repoPath: "/repo-b",
        }),
        "repo-a": createRepoConfig(),
      },
      globalPromptOverrides: {},
    };

    expect(pickInitialWorkspaceId(snapshot, "/repo-b")).toBe("repo-b");
    expect(pickInitialWorkspaceId(snapshot, "/missing")).toBe("repo-a");
    expect(
      pickInitialWorkspaceId(
        {
          theme: "light" as const,
          git: {
            defaultMergeMethod: "merge_commit" as const,
          },
          chat: {
            showThinkingMessages: false,
          },
          kanban: {
            doneVisibleDays: 1,
            emptyColumnDisplay: "show" as const,
          },
          autopilot: {
            rules: [],
          },
          workspaces: {},
          globalPromptOverrides: {},
        },
        null,
      ),
    ).toBeNull();
  });

  test("resolves inherited preview from global override and builtin", () => {
    const fromGlobal = resolveInheritedPromptPreview(
      "kickoff.spec_initial",
      {
        template: "repo override",
        baseVersion: 2,
        enabled: false,
      },
      {
        "kickoff.spec_initial": {
          template: "global override",
          baseVersion: 1,
          enabled: true,
        },
      },
      "builtin",
    );
    expect(fromGlobal).toEqual({
      sourceLabel: "Global override",
      template: "global override",
    });

    const fromBuiltin = resolveInheritedPromptPreview(
      "kickoff.spec_initial",
      {
        template: "repo override",
        baseVersion: 2,
        enabled: false,
      },
      {},
      "builtin prompt",
    );
    expect(fromBuiltin).toEqual({
      sourceLabel: "Builtin prompt",
      template: "builtin prompt",
    });

    const hiddenWhenRepoEnabled = resolveInheritedPromptPreview(
      "kickoff.spec_initial",
      {
        template: "repo override",
        baseVersion: 2,
        enabled: true,
      },
      {},
      "builtin prompt",
    );
    expect(hiddenWhenRepoEnabled).toBeUndefined();
  });
});
