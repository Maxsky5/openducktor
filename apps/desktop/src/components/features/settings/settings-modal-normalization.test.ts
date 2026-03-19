import { describe, expect, test } from "bun:test";
import {
  type AgentPromptTemplateId,
  agentPromptTemplateIdValues,
  type RepoConfig,
  type RepoPromptOverrides,
} from "@openducktor/contracts";
import {
  normalizePromptOverridesForSave,
  normalizeRepoConfigForSave,
  normalizeSnapshotForSave,
  pickInitialRepoPath,
  resolveInheritedPromptPreview,
} from "./settings-modal-normalization";

const createRepoConfig = (): RepoConfig => ({
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
    {
      id: "backend",
      name: " Backend ",
      command: "   ",
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
        baseVersion: 3,
        enabled: true,
      },
      "system.shared.tool_protocol": {
        template: " protocol override ",
        baseVersion: 4,
        enabled: false,
      },
    });

    expect(normalized).toEqual({
      "system.shared.workflow_guards": {
        template: "guards override",
        baseVersion: 3,
        enabled: true,
      },
      "system.shared.tool_protocol": {
        template: "protocol override",
        baseVersion: 4,
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

  test("disables trusted hooks when dev server commands are removed during normalization", () => {
    const normalized = normalizeRepoConfigForSave({
      ...createRepoConfig(),
      trustedHooks: true,
      trustedHooksFingerprint: "fingerprint",
      hooks: {
        preStart: [],
        postComplete: [],
      },
      devServers: [{ id: "frontend", name: "Frontend", command: "   " }],
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
    ).toThrow("Dev server names cannot be blank");
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

  test("normalizes snapshot repo map and global prompt overrides", () => {
    const snapshot = normalizeSnapshotForSave({
      theme: "light",
      git: {
        defaultMergeMethod: "merge_commit",
      },
      chat: {
        showThinkingMessages: true,
      },
      repos: {
        "/repo-a": createRepoConfig(),
      },
      globalPromptOverrides: {
        "kickoff.spec_initial": {
          template: " global ",
          baseVersion: 2,
          enabled: false,
        },
      },
    });

    expect(snapshot.repos["/repo-a"]?.hooks.preStart).toEqual(["npm ci"]);
    expect(snapshot.repos["/repo-a"]?.devServers).toEqual([
      {
        id: "frontend",
        name: "Frontend",
        command: "bun run dev",
      },
    ]);
    expect(snapshot.chat.showThinkingMessages).toBe(true);
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
      repos: {
        "/repo-b": createRepoConfig(),
        "/repo-a": createRepoConfig(),
      },
      globalPromptOverrides: {},
    };

    expect(pickInitialRepoPath(snapshot, "/repo-b")).toBe("/repo-b");
    expect(pickInitialRepoPath(snapshot, "/missing")).toBe("/repo-a");
    expect(
      pickInitialRepoPath(
        {
          theme: "light" as const,
          git: {
            defaultMergeMethod: "merge_commit" as const,
          },
          chat: {
            showThinkingMessages: false,
          },
          repos: {},
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
