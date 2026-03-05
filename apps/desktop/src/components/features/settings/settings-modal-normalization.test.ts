import { describe, expect, test } from "bun:test";
import type { RepoConfig } from "@openducktor/contracts";
import {
  normalizePromptOverridesForSave,
  normalizeRepoConfigForSave,
  normalizeSnapshotForSave,
  pickInitialRepoPath,
  resolveInheritedPromptPreview,
} from "./settings-modal-normalization";

const createRepoConfig = (): RepoConfig => ({
  worktreeBasePath: "  /tmp/worktrees  ",
  branchPrefix: "  ",
  defaultTargetBranch: "main",
  trustedHooks: true,
  trustedHooksFingerprint: "fingerprint",
  hooks: {
    preStart: [" npm ci ", " "],
    postComplete: [" npm test ", ""],
  },
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
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      opencodeAgent: "spec",
    },
    planner: {
      providerId: "openai",
      modelId: "",
      variant: "high",
      opencodeAgent: "planner",
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
    });
  });

  test("normalizes repo config and removes incomplete agent defaults", () => {
    const normalized = normalizeRepoConfigForSave(createRepoConfig());

    expect(normalized.branchPrefix).toBe("obp");
    expect(normalized.defaultTargetBranch).toBe("origin/main");
    expect(normalized.worktreeBasePath).toBe("/tmp/worktrees");
    expect(normalized.hooks).toEqual({
      preStart: ["npm ci"],
      postComplete: ["npm test"],
    });
    expect(normalized.worktreeFileCopies).toEqual([".env"]);
    expect(normalized.promptOverrides).toEqual({
      "kickoff.spec_initial": {
        template: "custom kickoff",
        baseVersion: 1,
        enabled: true,
      },
    });
    expect(normalized.agentDefaults).toEqual({
      spec: {
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        opencodeAgent: "spec",
      },
    });
  });

  test("normalizes snapshot repo map and global prompt overrides", () => {
    const snapshot = normalizeSnapshotForSave({
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
    expect(snapshot.globalPromptOverrides).toEqual({
      "kickoff.spec_initial": {
        template: "global",
        baseVersion: 2,
        enabled: false,
      },
    });
  });

  test("selects initial repo using active repo when available", () => {
    const snapshot = {
      repos: {
        "/repo-b": createRepoConfig(),
        "/repo-a": createRepoConfig(),
      },
      globalPromptOverrides: {},
    };

    expect(pickInitialRepoPath(snapshot, "/repo-b")).toBe("/repo-b");
    expect(pickInitialRepoPath(snapshot, "/missing")).toBe("/repo-a");
    expect(pickInitialRepoPath({ repos: {}, globalPromptOverrides: {} }, null)).toBeNull();
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
