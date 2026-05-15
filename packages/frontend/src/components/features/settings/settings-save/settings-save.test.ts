import { describe, expect, test } from "bun:test";
import {
  type AgentPromptTemplateId,
  agentPromptTemplateIdValues,
  DEFAULT_AGENT_RUNTIMES,
  type RepoConfig,
  type RepoPromptOverrides,
} from "@openducktor/contracts";
import { prepareAutopilotSettingsForSave } from "./autopilot-settings";
import { preparePromptOverridesForSave } from "./prompt-overrides";
import { prepareRepoConfigForSave } from "./repo-config";
import { prepareSettingsSnapshotForSave } from "./settings-snapshot";

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

describe("settings save transforms", () => {
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

    const saveReady = preparePromptOverridesForSave(source);
    const saveReadyKeys = Object.keys(saveReady).sort();
    expect(saveReadyKeys).toEqual(agentPromptTemplateIdValues.toSorted());

    for (const [index, templateId] of agentPromptTemplateIdValues.entries()) {
      const entry = saveReady[templateId as AgentPromptTemplateId];
      expect(entry).toEqual({
        template: `${templateId} template`,
        baseVersion: index + 1,
        enabled: index % 2 === 0,
      });
    }
  });

  test("prepares repo config and removes incomplete agent defaults", () => {
    const saveReady = prepareRepoConfigForSave(createRepoConfig());

    expect(saveReady.defaultRuntimeKind).toBe("opencode");
    expect(saveReady.branchPrefix).toBe("odt");
    expect(saveReady.defaultTargetBranch).toEqual({ remote: "origin", branch: "main" });
    expect(saveReady.worktreeBasePath).toBe("/tmp/worktrees");
    expect(saveReady.hooks).toEqual({
      preStart: ["npm ci"],
      postComplete: ["npm test"],
    });
    expect(saveReady.devServers).toEqual([
      {
        id: "frontend",
        name: "Frontend",
        command: "bun run dev",
      },
    ]);
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

  test("rejects configured agent defaults without runtime kind", () => {
    expect(() =>
      prepareRepoConfigForSave({
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

  test("prepares autopilot settings in canonical event order", () => {
    const saveReady = prepareAutopilotSettingsForSave({
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
  });

  test("normalizes empty hook commands to empty arrays", () => {
    const saveReady = prepareRepoConfigForSave({
      ...createRepoConfig(),
      hooks: {
        preStart: ["   "],
        postComplete: [""],
      },
      devServers: [],
    });

    expect(saveReady.hooks).toEqual({
      preStart: [],
      postComplete: [],
    });
  });

  test("normalizes empty dev server rows away", () => {
    const saveReady = prepareRepoConfigForSave({
      ...createRepoConfig(),
      hooks: {
        preStart: [],
        postComplete: [],
      },
      devServers: [{ id: "frontend", name: "Frontend", command: "   " }],
    });

    expect(saveReady.devServers).toEqual([]);
  });

  test("rejects blank dev server names when commands remain configured", () => {
    expect(() =>
      prepareRepoConfigForSave({
        ...createRepoConfig(),
        devServers: [{ id: "frontend", name: "   ", command: "bun run dev" }],
      }),
    ).toThrow("Dev server tab labels cannot be blank");
  });

  test("rejects blank dev server ids when commands remain configured", () => {
    expect(() =>
      prepareRepoConfigForSave({
        ...createRepoConfig(),
        devServers: [{ id: "   ", name: "Frontend", command: "bun run dev" }],
      }),
    ).toThrow("Dev server id cannot be blank.");
  });

  test("normalizes hook commands when configured", () => {
    const saveReady = prepareRepoConfigForSave({
      ...createRepoConfig(),
      hooks: {
        preStart: [" bun install "],
        postComplete: [],
      },
      devServers: [],
    });

    expect(saveReady.hooks).toEqual({
      preStart: ["bun install"],
      postComplete: [],
    });
  });

  test("normalizes snapshot workspace map and global prompt overrides", () => {
    const snapshot = prepareSettingsSnapshotForSave({
      theme: "light",
      git: {
        defaultMergeMethod: "merge_commit",
      },
      general: {
        openAgentStudioTabOnBackgroundSessionStart: true,
      },
      chat: {
        showThinkingMessages: true,
      },
      reusablePrompts: [
        {
          id: " prompt-1 ",
          name: " review ",
          description: " Review context ",
          content: " Review this. ",
        },
      ],
      kanban: {
        doneVisibleDays: 1,
        emptyColumnDisplay: "show" as const,
      },
      autopilot: {
        rules: [],
      },
      agentRuntimes: DEFAULT_AGENT_RUNTIMES,
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
    expect(snapshot.reusablePrompts).toEqual([
      {
        id: "prompt-1",
        name: "review",
        description: "Review context",
        content: "Review this.",
      },
    ]);
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
});
