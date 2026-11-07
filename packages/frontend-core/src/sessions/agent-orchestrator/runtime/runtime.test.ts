import { describe, expect, test } from "bun:test";
import { type RepoConfig } from "@openducktor/contracts";
import { loadRepoDefaultModel, requireConfiguredRuntimeKind } from "./runtime";

const createRepoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/tmp/repo",
  branchPrefix: "obp",
  defaultModel: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
  },
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { beforeWorktreeRemoval: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentStudioState: { openTaskIds: [] },
  agentDefaults: {},
  ...overrides,
});

describe("agent-orchestrator-runtime", () => {
  test.each([null, undefined])(
    "rejects a missing runtime with caller instructions: %s",
    (runtimeKind) => {
      expect(() =>
        requireConfiguredRuntimeKind(runtimeKind, "Select a runtime before starting."),
      ).toThrow("Select a runtime before starting.");
    },
  );

  test("propagates repo config loading errors when default model lookup fails", async () => {
    await expect(
      loadRepoDefaultModel("/tmp/repo", "build", async () => {
        throw new Error("missing config");
      }),
    ).rejects.toThrow("missing config");
  });

  test("maps repo role defaults into model selection", async () => {
    const selection = await loadRepoDefaultModel("/tmp/repo", "build", async () =>
      createRepoConfig({
        agentDefaults: {
          build: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "high",
            profileId: "builder",
          },
        },
      }),
    );
    expect(selection).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "builder",
    });
  });
});
