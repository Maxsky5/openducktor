import { describe, expect, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type SettingsRepoConfig,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  ensureDraftAgentDefault,
  findCatalogModel,
  isSettingsInteractionDisabled,
  resolveRepoAgentDefaultRuntimeKind,
  selectedModelKeyForRole,
  toRoleVariantOptions,
  updateRepoDefaultModel,
} from "./settings-modal-model";

const catalogFixture: AgentModelCatalog = {
  models: [
    {
      id: "openai/gpt-5",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "gpt-5",
      modelName: "GPT-5",
      variants: ["default", "thinking"],
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
  profiles: [{ name: "build", mode: "all" }],
};

const emptyDefaults = {
  spec: null,
  planner: null,
  build: null,
  qa: null,
};

const OPENCODE_DESCRIPTOR = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
} satisfies RuntimeDescriptor;

const CODEX_DESCRIPTOR = {
  ...OPENCODE_RUNTIME_DESCRIPTOR,
  kind: "opencode",
  label: "Codex",
  description: "Codex runtime",
} satisfies RuntimeDescriptor;

const createRepoConfig = (overrides: Partial<SettingsRepoConfig> = {}): SettingsRepoConfig => ({
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultModel: {
    runtimeKind: "opencode",
    providerId: "openai",
    modelId: "gpt-5",
    variant: "",
    profileId: "",
  },
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { beforeWorktreeRemoval: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  promptAppends: {},
  agentDefaults: {},
  ...overrides,
});

describe("settings-modal-model", () => {
  test("keeps settings interactive while runtime executables are checked", () => {
    expect(
      isSettingsInteractionDisabled({
        isLoadingSettings: false,
        isSaving: false,
        isCheckingRuntimeExecutables: true,
      }),
    ).toBe(false);
    expect(
      isSettingsInteractionDisabled({
        isLoadingSettings: true,
        isSaving: false,
        isCheckingRuntimeExecutables: false,
      }),
    ).toBe(true);
    expect(
      isSettingsInteractionDisabled({
        isLoadingSettings: false,
        isSaving: true,
        isCheckingRuntimeExecutables: false,
      }),
    ).toBe(true);
  });

  test("normalizes null defaults to empty values", () => {
    expect(ensureDraftAgentDefault(null)).toEqual({
      providerId: "",
      modelId: "",
      variant: "",
      profileId: "",
    });
  });

  test("updates the repository default model immutably", () => {
    const next = updateRepoDefaultModel(
      {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "",
        profileId: "",
      },
      "profileId",
      "builder",
    );

    expect(next).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "",
      profileId: "builder",
    });
  });

  test("skips the repository default model update when no runtime kind exists", () => {
    expect(
      updateRepoDefaultModel({ providerId: "openai", modelId: "gpt-5" }, "profileId", "builder"),
    ).toBeNull();
  });

  test("resolves model key and variants for role", () => {
    const defaults = {
      ...emptyDefaults,
      planner: {
        runtimeKind: "opencode" as const,
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "planner",
      },
    };

    expect(selectedModelKeyForRole(defaults, "planner")).toBe("openai/gpt-5");
    expect(findCatalogModel(catalogFixture, "openai/gpt-5")?.modelName).toBe("GPT-5");
    expect(toRoleVariantOptions(catalogFixture, defaults, "planner")).toEqual([
      { value: "default", label: "default" },
      { value: "thinking", label: "thinking" },
    ]);
  });

  test("finds models by provider/model option key when catalog ids differ", () => {
    expect(
      findCatalogModel(
        {
          ...catalogFixture,
          models: [
            {
              id: "codex-model-o3",
              providerId: "openai",
              providerName: "OpenAI",
              modelId: "o3",
              modelName: "o3",
              variants: ["low"],
            },
          ],
        },
        "openai/o3",
      )?.modelName,
    ).toBe("o3");
  });

  test("resolves inherited role runtime kinds from the repo default runtime", () => {
    expect(
      resolveRepoAgentDefaultRuntimeKind({
        selectedRepoConfig: createRepoConfig({
          agentDefaults: {
            spec: undefined,
            planner: undefined,
            build: undefined,
            qa: undefined,
          },
        }),
        runtimeDefinitions: [OPENCODE_DESCRIPTOR, CODEX_DESCRIPTOR],
        role: "spec",
      }),
    ).toBe("opencode");
  });
});
