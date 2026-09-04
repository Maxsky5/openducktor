import { describe, expect, mock, test } from "bun:test";
import {
  agentPromptTemplateIdValues,
  type RepoConfig,
  type SettingsSnapshot,
  taskMetadataPayloadSchema,
} from "@openducktor/contracts";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { loadRepoDefaultModel, loadRepoPromptOverrides, loadTaskDocuments } from "./runtime";

const createRepoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/tmp/repo",
  defaultRuntimeKind: "opencode",
  branchPrefix: "obp",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentStudioState: { openTaskIds: [] },
  agentDefaults: {},
  ...overrides,
});

const createPromptOverrideRepoConfig = (
  promptOverrides: RepoConfig["promptOverrides"],
): RepoConfig => createRepoConfig({ promptOverrides });

const createPromptOverrideSettingsSnapshot = (
  globalPromptOverrides: SettingsSnapshot["globalPromptOverrides"],
): SettingsSnapshot => createSettingsSnapshotFixture({ globalPromptOverrides });

describe("agent-orchestrator-runtime", () => {
  test("loads startup documents from one fresh task metadata read", async () => {
    const taskMetadata = taskMetadataPayloadSchema.parse({
      spec: { markdown: "# Spec", updatedAt: "2026-04-10T13:10:00.000Z" },
      plan: { markdown: "# Plan", updatedAt: "2026-04-10T13:10:00.000Z" },
      qaReport: {
        markdown: "# QA",
        verdict: "approved",
        updatedAt: "2026-04-10T13:10:00.000Z",
      },
    });
    const taskMetadataGetFresh = mock(async () => taskMetadata);

    await expect(loadTaskDocuments("/tmp/repo", "task-1", taskMetadataGetFresh)).resolves.toEqual({
      specMarkdown: "# Spec",
      planMarkdown: "# Plan",
      qaMarkdown: "# QA",
    });
    expect(taskMetadataGetFresh).toHaveBeenCalledWith("/tmp/repo", "task-1");
  });

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

  test("merges global and repository prompt overrides", async () => {
    const overrides = await loadRepoPromptOverrides("/tmp/repo", {
      loadRepoConfig: async () =>
        createPromptOverrideRepoConfig({
          "kickoff.planner_initial": {
            template: "repo planner {{task.id}}",
            baseVersion: 1,
            enabled: true,
          },
          "kickoff.spec_initial": {
            template: "repo disabled {{task.id}}",
            baseVersion: 1,
            enabled: false,
          },
        }),
      loadSettingsSnapshot: async () =>
        createPromptOverrideSettingsSnapshot({
          "kickoff.spec_initial": {
            template: "global kickoff {{task.id}}",
            baseVersion: 1,
            enabled: true,
          },
        }),
    });

    expect(overrides["kickoff.spec_initial"]?.template).toBe("global kickoff {{task.id}}");
    expect(overrides["kickoff.planner_initial"]?.template).toBe("repo planner {{task.id}}");
  });

  test("resolves every prompt override deterministically", async () => {
    const globalPromptOverrides = Object.fromEntries(
      agentPromptTemplateIdValues.map((templateId) => [
        templateId,
        { template: `global ${templateId}`, baseVersion: 1, enabled: true },
      ]),
    );
    const repoPromptOverrides = Object.fromEntries(
      agentPromptTemplateIdValues.map((templateId, index) => [
        templateId,
        { template: `repo ${templateId}`, baseVersion: 1, enabled: index % 2 === 0 },
      ]),
    );

    const overrides = await loadRepoPromptOverrides("/tmp/repo", {
      loadRepoConfig: async () => createPromptOverrideRepoConfig(repoPromptOverrides),
      loadSettingsSnapshot: async () => createPromptOverrideSettingsSnapshot(globalPromptOverrides),
    });

    for (const [index, templateId] of agentPromptTemplateIdValues.entries()) {
      expect(overrides[templateId]?.template).toBe(
        index % 2 === 0 ? `repo ${templateId}` : `global ${templateId}`,
      );
    }
  });
});
