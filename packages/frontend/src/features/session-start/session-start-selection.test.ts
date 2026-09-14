import { describe, expect, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  availableDefaultSessionSelectionFor,
  defaultSessionSelectionFor,
  roleDefaultSelectionFor,
} from "./session-start-selection";

const createRepoSettings = (overrides: Partial<RepoSettingsInput> = {}): RepoSettingsInput => ({
  worktreeBasePath: "",
  branchPrefix: "",
  defaultModel: null,
  defaultTargetBranch: { remote: "origin", branch: "main" },
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeCopyPaths: [],
  agentDefaults: {
    spec: null,
    planner: null,
    build: null,
    qa: null,
  },
  ...overrides,
});

describe("session-start role defaults", () => {
  test("maps a workflow role default to the generic selection shape", () => {
    expect(
      roleDefaultSelectionFor(
        createRepoSettings({
          agentDefaults: {
            spec: null,
            planner: null,
            build: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              variant: "high",
              profileId: "build-agent",
            },
            qa: null,
          },
        }),
        "build",
      ),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "build-agent",
    });
  });

  test("falls back to the repository default model when the role has no default", () => {
    const settings = createRepoSettings({
      defaultModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "",
        profileId: "",
      },
    });

    expect(defaultSessionSelectionFor(settings, "build")).toEqual({
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "gpt-5",
    });
  });

  test("keeps only role defaults whose runtime is available for a new session", () => {
    const settings = createRepoSettings({
      agentDefaults: {
        spec: null,
        planner: null,
        build: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "",
          profileId: "",
        },
        qa: null,
      },
    });

    expect(
      availableDefaultSessionSelectionFor({
        repoSettings: settings,
        role: "build",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBeNull();
    expect(
      availableDefaultSessionSelectionFor({
        repoSettings: settings,
        role: "build",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR],
      }),
    ).toEqual({
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "gpt-5",
    });
  });

  test("drops the repository default model when its runtime is unavailable", () => {
    const settings = createRepoSettings({
      defaultModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "",
        profileId: "",
      },
    });

    expect(
      availableDefaultSessionSelectionFor({
        repoSettings: settings,
        role: "build",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBeNull();
  });
});
