import { describe, expect, test } from "bun:test";
import {
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepoConfig,
  type RepoPromptOverrides,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import {
  buildPromptOverrideValidationErrors,
  canResetPromptOverrideToBuiltin,
  clearRoleDefault,
  ensureAgentDefault,
  findCatalogModel,
  getMissingRequiredRoleLabels,
  getNeededCatalogRuntimeKinds,
  removePromptOverride,
  resetPromptOverrideToBuiltin,
  resolvePromptOverrideFallbackTemplate,
  resolveRepoAgentDefaultRuntimeKind,
  selectedModelKeyForRole,
  togglePromptOverrideEnabled,
  toRoleVariantOptions,
  updatePromptOverrideTemplate,
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
  kind: "codex",
  label: "Codex",
  description: "Codex runtime",
} satisfies RuntimeDescriptor;

const createRepoConfig = (overrides: Partial<RepoConfig> = {}): RepoConfig => ({
  defaultRuntimeKind: "opencode",
  worktreeBasePath: undefined,
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {
    providers: {},
  },
  trustedHooks: false,
  trustedHooksFingerprint: undefined,
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeFileCopies: [],
  promptOverrides: {},
  agentDefaults: {},
  ...overrides,
});

describe("settings-modal-model", () => {
  test("normalizes null defaults to empty values", () => {
    expect(ensureAgentDefault(null)).toEqual({
      runtimeKind: "opencode",
      providerId: "",
      modelId: "",
      variant: "",
      profileId: "",
    });
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
        runtimeKind: "opencode",
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

  test("reports missing required role labels", () => {
    const defaults = {
      ...emptyDefaults,
      spec: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "default",
        profileId: "spec",
      },
    };

    expect(getMissingRequiredRoleLabels(defaults)).toEqual(["Planner", "Builder", "QA"]);
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
          defaultRuntimeKind: "codex",
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
    ).toBe("codex");
  });

  test("derives unique catalog targets from mixed role overrides", () => {
    expect(
      getNeededCatalogRuntimeKinds(
        createRepoConfig({
          defaultRuntimeKind: "opencode",
          agentDefaults: {
            spec: {
              runtimeKind: "codex",
              providerId: "openai",
              modelId: "gpt-5",
              variant: "default",
              profileId: "spec-agent",
            },
            planner: {
              runtimeKind: "codex",
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
    ).toEqual(["codex", "opencode"]);
  });

  test("returns an empty target list when no runtime definitions are available", () => {
    expect(getNeededCatalogRuntimeKinds(createRepoConfig(), [])).toEqual([]);
  });

  test("resolves missing stored runtime kinds through existing runtime resolution", () => {
    expect(
      getNeededCatalogRuntimeKinds(
        createRepoConfig({
          defaultRuntimeKind: "missing-runtime",
          agentDefaults: {
            spec: {
              runtimeKind: "also-missing",
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
    ).toEqual(["codex"]);
  });

  test("resets prompt override only when it exists and preserves enabled flag", () => {
    const overrides: RepoPromptOverrides = {
      "kickoff.spec_initial": {
        template: "custom",
        baseVersion: 2,
        enabled: false,
      },
    };

    const unchanged = resetPromptOverrideToBuiltin(
      overrides,
      "kickoff.planner_initial",
      "builtin planner",
      4,
    );
    expect(unchanged).toBe(overrides);

    const reset = resetPromptOverrideToBuiltin(
      overrides,
      "kickoff.spec_initial",
      "builtin spec",
      5,
    );
    expect(reset["kickoff.spec_initial"]).toEqual({
      template: "builtin spec",
      baseVersion: 5,
      enabled: false,
    });
  });

  test("computes reset eligibility from override diff against builtin", () => {
    expect(canResetPromptOverrideToBuiltin(undefined, "builtin")).toBe(false);
    expect(
      canResetPromptOverrideToBuiltin(
        {
          template: "builtin\r\n",
          baseVersion: 1,
          enabled: true,
        },
        "builtin",
      ),
    ).toBe(false);
    expect(
      canResetPromptOverrideToBuiltin(
        {
          template: "custom prompt",
          baseVersion: 1,
          enabled: false,
        },
        "builtin",
      ),
    ).toBe(true);
  });

  test("removes prompt override only when entry exists", () => {
    const overrides: RepoPromptOverrides = {
      "kickoff.spec_initial": {
        template: "custom",
        baseVersion: 2,
        enabled: true,
      },
    };

    const unchanged = removePromptOverride(overrides, "kickoff.qa_review");
    expect(unchanged).toBe(overrides);

    const removed = removePromptOverride(overrides, "kickoff.spec_initial");
    expect(removed["kickoff.spec_initial"]).toBeUndefined();
  });

  test("validates unsupported placeholders in prompt overrides", () => {
    const overrides: RepoPromptOverrides = {
      "kickoff.spec_initial": {
        template: "Good {{task.id}}",
        baseVersion: 1,
        enabled: true,
      },
      "system.scenario.spec_initial": {
        template: "Bad {{task.foo}} and {{unknown.value}}",
        baseVersion: 1,
        enabled: true,
      },
    };

    expect(buildPromptOverrideValidationErrors(overrides)).toEqual({
      "system.scenario.spec_initial": "Unsupported placeholders: {{task.foo}}, {{unknown.value}}.",
    });
  });

  test("enables prompt override and creates missing entries from fallback values", () => {
    const emptyOverrides: RepoPromptOverrides = {};
    const created = togglePromptOverrideEnabled(
      emptyOverrides,
      "kickoff.spec_initial",
      true,
      "builtin",
      2,
    );
    expect(created["kickoff.spec_initial"]).toEqual({
      template: "builtin",
      baseVersion: 2,
      enabled: true,
    });

    const disabled = togglePromptOverrideEnabled(
      created,
      "kickoff.spec_initial",
      false,
      "builtin",
      2,
    );
    expect(disabled["kickoff.spec_initial"]).toEqual({
      template: "builtin",
      baseVersion: 2,
      enabled: false,
    });
  });

  test("uses inherited template as fallback when creating a newly enabled override", () => {
    const emptyOverrides: RepoPromptOverrides = {};
    const created = togglePromptOverrideEnabled(
      emptyOverrides,
      "system.shared.workflow_guards",
      true,
      resolvePromptOverrideFallbackTemplate("global workflow guards", "builtin workflow guards"),
      1,
    );

    expect(created["system.shared.workflow_guards"]).toEqual({
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
      "kickoff.spec_initial",
      "custom",
      9,
    );
    expect(created["kickoff.spec_initial"]).toEqual({
      template: "custom",
      baseVersion: 9,
      enabled: false,
    });

    const enabledOverrides: RepoPromptOverrides = {
      "kickoff.spec_initial": {
        template: "old",
        baseVersion: 2,
        enabled: true,
      },
    };
    const updated = updatePromptOverrideTemplate(
      enabledOverrides,
      "kickoff.spec_initial",
      "new",
      10,
    );
    expect(updated["kickoff.spec_initial"]).toEqual({
      template: "new",
      baseVersion: 2,
      enabled: true,
    });
  });
});
