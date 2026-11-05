import { specPlanBuildPromptKey } from "@openducktor/workflows/test-support";
import { workflowSettingsData } from "@openducktor/frontend-core/queries/workflow-settings";
import { builtinCompiledCatalogFixture } from "@openducktor/frontend-core/test-support/workflow-fixtures";

import { describe, expect, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type SettingsRepoConfig,
  type RepoPromptOverrides,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  buildPromptOverrideValidationErrors,
  canClearPromptOverride,
  clearPromptOverride,
  clearRoleDefault,
  ensureDraftAgentDefault,
  findCatalogModel,
  getNeededCatalogRuntimeKinds,
  isSettingsInteractionDisabled,
  resolvePromptOverrideFallbackTemplate,
  resolveRepoAgentDefaultRuntimeKind,
  selectedModelKeyForRole,
  togglePromptOverrideEnabled,
  toRoleVariantOptions,
  updatePromptOverrideTemplate,
  updateRepoDefaultModel,
  updateRoleDefault,
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
  hooks: { postComplete: [] },
  actions: { items: [], defaultActionId: null },
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
  ...overrides,
});

const builtinSettingsTemplates = workflowSettingsData(builtinCompiledCatalogFixture).templates;

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

  test("updates and clears role defaults immutably", () => {
    const withModel = updateRoleDefault(emptyDefaults, "build", "modelId", "gpt-5");
    const withAgent = updateRoleDefault(withModel, "build", "profileId", "builder");
    const cleared = clearRoleDefault(withAgent, "build");

    expect(withModel.build?.modelId).toBe("gpt-5");
    expect(withAgent.build?.profileId).toBe("builder");
    expect(cleared.build).toBeNull();
    expect(cleared.spec).toBeNull();
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

  test("derives one catalog target when all roles inherit the same runtime", () => {
    expect(
      getNeededCatalogRuntimeKinds(createRepoConfig(), [OPENCODE_DESCRIPTOR, CODEX_DESCRIPTOR]),
    ).toEqual(["opencode"]);
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

  test("derives unique catalog targets from mixed role overrides", () => {
    expect(
      getNeededCatalogRuntimeKinds(
        createRepoConfig({
          agentDefaults: {
            spec: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              variant: "default",
              profileId: "spec-agent",
            },
            planner: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              variant: "default",
              profileId: "planner-agent",
            },
            build: undefined,
            qa: undefined,
          },
        }),
        [OPENCODE_DESCRIPTOR, CODEX_DESCRIPTOR],
      ),
    ).toEqual(["opencode"]);
  });

  test("returns an empty target list when no runtime definitions are available", () => {
    expect(getNeededCatalogRuntimeKinds(createRepoConfig(), [])).toEqual([]);
  });

  test("skips unknown stored runtime kinds instead of resolving to another runtime", () => {
    expect(
      getNeededCatalogRuntimeKinds(
        createRepoConfig({
          agentDefaults: {
            spec: {
              runtimeKind: "opencode",
              providerId: "openai",
              modelId: "gpt-5",
              variant: "default",
              profileId: "spec-agent",
            },
            planner: undefined,
            build: undefined,
            qa: undefined,
          },
        }),
        [CODEX_DESCRIPTOR],
      ),
    ).toEqual(["opencode"]);
  });

  test("clears prompt override by removing only the stored value", () => {
    const overrides = {
      [specPlanBuildPromptKey("messages.spec_start")]: {
        template: "custom",
        baseVersion: 2,
        enabled: false,
      },
      [specPlanBuildPromptKey("messages.plan_start")]: {
        template: "planner custom",
        baseVersion: 3,
        enabled: true,
      },
    } satisfies RepoPromptOverrides;

    const unchanged = clearPromptOverride(overrides, specPlanBuildPromptKey("messages.qa_review"));
    expect(unchanged).toBe(overrides);

    const cleared = clearPromptOverride(overrides, specPlanBuildPromptKey("messages.spec_start"));
    expect(cleared[specPlanBuildPromptKey("messages.spec_start")]).toBeUndefined();
    expect(cleared[specPlanBuildPromptKey("messages.plan_start")]).toEqual(
      overrides[specPlanBuildPromptKey("messages.plan_start")],
    );
  });

  test("enables clearing whenever a stored prompt override exists", () => {
    expect(canClearPromptOverride(undefined)).toBe(false);
    expect(
      canClearPromptOverride({
        template: "builtin\r\n",
        baseVersion: 1,
        enabled: true,
      }),
    ).toBe(true);
    expect(
      canClearPromptOverride({
        template: "reusable prompt",
        baseVersion: 1,
        enabled: false,
      }),
    ).toBe(true);
  });

  test("validates unsupported placeholders in prompt overrides", () => {
    const overrides = {
      [specPlanBuildPromptKey("messages.spec_start")]: {
        template: "Good {{task.id}}",
        baseVersion: 1,
        enabled: true,
      },
      [specPlanBuildPromptKey("messages.build_pull_request")]: {
        template:
          "Bad {{task.foo}} and {{unknown.value}} with {{git.targetBranch}} and {{git.pullRequestBaseBranch}}",
        baseVersion: 1,
        enabled: true,
      },
    } satisfies RepoPromptOverrides;

    expect(buildPromptOverrideValidationErrors(overrides, builtinSettingsTemplates)).toEqual({
      [specPlanBuildPromptKey("messages.build_pull_request")]:
        "Unsupported placeholders: {{task.foo}}, {{unknown.value}}, {{git.pullRequestBaseBranch}}.",
    });
  });

  test("validates required placeholders in human-review kickoff overrides", () => {
    const overrides = {
      [specPlanBuildPromptKey("messages.build_requested_changes")]: {
        template: "Review {{task.id}} before editing.",
        baseVersion: 3,
        enabled: true,
      },
    } satisfies RepoPromptOverrides;

    expect(buildPromptOverrideValidationErrors(overrides, builtinSettingsTemplates)).toEqual({
      [specPlanBuildPromptKey("messages.build_requested_changes")]:
        "Missing required placeholder: {{humanFeedback}}.",
    });
  });

  test("ignores validation errors in disabled prompt overrides", () => {
    const overrides = {
      [specPlanBuildPromptKey("messages.build_pull_request")]: {
        template: "Publish the pull request.",
        baseVersion: 4,
        enabled: false,
      },
      [specPlanBuildPromptKey("messages.spec_start")]: {
        template: "Unsupported {{task.foo}}",
        baseVersion: 1,
        enabled: false,
      },
    } satisfies RepoPromptOverrides;

    expect(buildPromptOverrideValidationErrors(overrides, builtinSettingsTemplates)).toEqual({});
  });

  test("enables prompt override and creates missing entries from fallback values", () => {
    const emptyOverrides: RepoPromptOverrides = {};
    const created = togglePromptOverrideEnabled(
      emptyOverrides,
      specPlanBuildPromptKey("messages.spec_start"),
      true,
      "builtin",
      2,
    );
    expect(created[specPlanBuildPromptKey("messages.spec_start")]).toEqual({
      template: "builtin",
      baseVersion: 2,
      enabled: true,
    });

    const disabled = togglePromptOverrideEnabled(
      created,
      specPlanBuildPromptKey("messages.spec_start"),
      false,
      "builtin",
      2,
    );
    expect(disabled[specPlanBuildPromptKey("messages.spec_start")]).toEqual({
      template: "builtin",
      baseVersion: 2,
      enabled: false,
    });
  });

  test("uses inherited template as fallback when creating a newly enabled override", () => {
    const emptyOverrides: RepoPromptOverrides = {};
    const created = togglePromptOverrideEnabled(
      emptyOverrides,
      specPlanBuildPromptKey("workflow.rules"),
      true,
      resolvePromptOverrideFallbackTemplate("global workflow guards", "builtin workflow guards"),
      1,
    );

    expect(created[specPlanBuildPromptKey("workflow.rules")]).toEqual({
      template: "global workflow guards",
      baseVersion: 1,
      enabled: true,
    });
  });

  test("falls back to builtin template when inherited template is unavailable", () => {
    expect(resolvePromptOverrideFallbackTemplate(undefined, "builtin")).toBe("builtin");
  });

  test("updates prompt override template without auto-enabling entries", () => {
    const emptyOverrides: RepoPromptOverrides = {};
    const created = updatePromptOverrideTemplate(
      emptyOverrides,
      specPlanBuildPromptKey("messages.spec_start"),
      "custom",
      9,
    );
    expect(created[specPlanBuildPromptKey("messages.spec_start")]).toEqual({
      template: "custom",
      baseVersion: 9,
      enabled: false,
    });

    const enabledOverrides = {
      [specPlanBuildPromptKey("messages.spec_start")]: {
        template: "old",
        baseVersion: 2,
        enabled: true,
      },
    } satisfies RepoPromptOverrides;
    const updated = updatePromptOverrideTemplate(
      enabledOverrides,
      specPlanBuildPromptKey("messages.spec_start"),
      "new",
      10,
    );
    expect(updated[specPlanBuildPromptKey("messages.spec_start")]).toEqual({
      template: "new",
      baseVersion: 2,
      enabled: true,
    });
  });
});
