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
  trustedHooks: true,
  trustedHooksFingerprint: "fingerprint",
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
  worktreeFileCopies: [" .env ", " "],
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
    expect(normalized.worktreeFileCopies).toEqual([".env"]);
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
    expect(normalized.trustedHooks).toBe(true);
    expect(normalized.trustedHooksFingerprint).toBe("fingerprint");
  });

  test("rejects configured agent defaults without runtime kind", () => {
    expect(() =>
      normalizeRepoConfigForSave({
        ...createRepoConfig(),
        agentDefaults: {
          ...createRepoConfig().agentDefaults,
          spec: {
            runtimeKind: "   ",
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

  test("rejects blank repo default runtime kinds", () => {
    expect(() =>
      normalizeRepoConfigForSave({
        ...createRepoConfig(),
        defaultRuntimeKind: "   ",
      }),
    ).toThrow("Default runtime kind cannot be blank.");
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

  test("disables trusted hooks when no hook commands remain after normalization", () => {
    const normalized = normalizeRepoConfigForSave({
      ...createRepoConfig(),
      trustedHooks: true,
      trustedHooksFingerprint: "fingerprint",
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
    expect(normalized.trustedHooks).toBe(false);
    expect(normalized.trustedHooksFingerprint).toBeUndefined();
  });

  test("disables trusted hooks when no dev server rows remain", () => {
    const normalized = normalizeRepoConfigForSave({
      ...createRepoConfig(),
      trustedHooks: true,
      trustedHooksFingerprint: "fingerprint",
      hooks: {
        preStart: [],
        postComplete: [],
      },
      devServers: [],
    });

    expect(normalized.devServers).toEqual([]);
    expect(normalized.trustedHooks).toBe(false);
    expect(normalized.trustedHooksFingerprint).toBeUndefined();
  });

  test("rejects blank dev server names when commands remain configured", () => {
    expect(() =>
      normalizeRepoConfigForSave({
        ...createRepoConfig(),
        devServers: [{ id: "frontend", name: "   ", command: "bun run dev" }],
      }),
    ).toThrow("Dev server tab labels cannot be blank");
  });

  test("rejects blank dev server commands", () => {
    expect(() =>
      normalizeRepoConfigForSave({
        ...createRepoConfig(),
        devServers: [{ id: "frontend", name: "Frontend", command: "   " }],
      }),
    ).toThrow("Dev server commands cannot be blank");
  });

  test("preserves explicit untrusted hooks when normalized hook commands exist", () => {
    const normalized = normalizeRepoConfigForSave({
      ...createRepoConfig(),
      trustedHooks: false,
      trustedHooksFingerprint: undefined,
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
    expect(normalized.trustedHooks).toBe(false);
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
