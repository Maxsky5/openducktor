import { describe, expect, mock, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  availableDefaultSessionSelectionFor,
  defaultSessionSelectionFor,
  resolveRequiredDefaultSessionSelection,
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

const CATALOG: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default", "high"],
    },
  ],
  defaultModelsByProvider: { openai: "gpt-5" },
  profiles: [{ name: "build-agent", mode: "primary", hidden: false }],
};

describe("required session default selection", () => {
  test("returns the role default coerced against its runtime catalog", async () => {
    const settings = createRepoSettings({
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
      defaultModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "",
        profileId: "",
      },
    });
    const loadRepoRuntimeCatalog = mock(async () => CATALOG);

    await expect(
      resolveRequiredDefaultSessionSelection({
        role: "build",
        repoSettings: settings,
        repoPath: "/repo",
        loadRepoRuntimeCatalog,
      }),
    ).resolves.toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "build-agent",
    });
    expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith({
      repoPath: "/repo",
      runtimeKind: "opencode",
    });
  });

  test("fails before loading a catalog when no default exists", async () => {
    const loadRepoRuntimeCatalog = mock(async () => CATALOG);

    await expect(
      resolveRequiredDefaultSessionSelection({
        role: "build",
        repoSettings: createRepoSettings(),
        repoPath: "/repo",
        loadRepoRuntimeCatalog,
      }),
    ).rejects.toThrow(
      "No model is configured for the Builder session. Set a Builder default or the repository Default Model in Settings > Repositories > Agents.",
    );
    expect(loadRepoRuntimeCatalog).not.toHaveBeenCalled();
  });

  test("fails when the catalog lacks the default model", async () => {
    const settings = createRepoSettings({
      defaultModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "removed-model",
        variant: "",
        profileId: "",
      },
    });
    const loadRepoRuntimeCatalog = mock(async () => CATALOG);

    await expect(
      resolveRequiredDefaultSessionSelection({
        role: "build",
        repoSettings: settings,
        repoPath: "/repo",
        loadRepoRuntimeCatalog,
      }),
    ).rejects.toThrow(
      "The saved Builder default or repository Default Model is not available for runtime opencode. Update it in Settings > Repositories > Agents.",
    );
  });

  test("fails with the saved default and the catalog cause when the runtime catalog rejects", async () => {
    const settings = createRepoSettings({
      defaultModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "",
        profileId: "",
      },
    });
    const loadRepoRuntimeCatalog = mock(async (): Promise<AgentModelCatalog> => {
      throw new Error("Cannot resolve the selected runtime. Start it from the runtime controls.");
    });

    await expect(
      resolveRequiredDefaultSessionSelection({
        role: "build",
        repoSettings: settings,
        repoPath: "/repo",
        loadRepoRuntimeCatalog,
      }),
    ).rejects.toThrow(
      "The saved Builder default or repository Default Model for runtime opencode could not load. Cannot resolve the selected runtime. Start it from the runtime controls. Update the default in Settings > Repositories > Agents.",
    );
  });
});
