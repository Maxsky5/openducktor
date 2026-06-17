import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import type { RepoSettingsInput } from "@/types/state-slices";
import {
  resolveAvailableRoleDefaultModelSelection,
  resolveChatComposerModelSelections,
  resolveChatComposerSelectedRuntimeKind,
  resolvePreferredModelSelection,
  toRoleDefaultModelSelection,
} from "./model-selection-preferences";

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
      contextWindow: 200_000,
      outputLimit: 8_192,
    },
    {
      id: "anthropic/claude-sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      variants: [],
      contextWindow: 100_000,
    },
  ],
  defaultModelsByProvider: {
    openai: "gpt-5",
  },
  profiles: [
    {
      name: "spec-agent",
      mode: "primary",
      hidden: false,
      color: "#f59e0b",
    },
    {
      name: "hidden-subagent",
      mode: "subagent",
      hidden: true,
    },
  ],
};

const createRepoSettings = (overrides: {
  defaultRuntimeKind?: "opencode" | "codex";
  buildDefault?: RepoSettingsInput["agentDefaults"]["build"];
}): RepoSettingsInput => ({
  defaultRuntimeKind: overrides.defaultRuntimeKind ?? "opencode",
  worktreeBasePath: "",
  branchPrefix: "",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  preStartHooks: [],
  postCompleteHooks: [],
  devServers: [],
  worktreeCopyPaths: [],
  agentDefaults: {
    spec: null,
    planner: null,
    build: overrides.buildDefault ?? null,
    qa: null,
  },
});

describe("model-selection-preferences", () => {
  test("maps repo role defaults to model selection shape", () => {
    expect(toRoleDefaultModelSelection(null)).toBeNull();
    expect(
      toRoleDefaultModelSelection({
        runtimeKind: "opencode",
        providerId: "",
        modelId: "gpt-5",
        variant: "high",
        profileId: "spec-agent",
      }),
    ).toBeNull();

    expect(
      toRoleDefaultModelSelection({
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "gpt-5",
        variant: "high",
        profileId: "spec-agent",
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    expect(
      toRoleDefaultModelSelection(
        {
          providerId: "anthropic",
          modelId: "claude-sonnet",
          variant: "",
          profileId: "",
        },
        "opencode",
      ),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
    });

    expect(
      toRoleDefaultModelSelection(
        {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          variant: "",
          profileId: "",
        },
        "opencode",
      ),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
    });
  });

  test("resolves available role defaults only for runtime definitions exposed to new sessions", () => {
    expect(
      resolveAvailableRoleDefaultModelSelection({
        repoSettings: createRepoSettings({
          buildDefault: {
            runtimeKind: "opencode",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "",
            profileId: "",
          },
        }),
        role: "build",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
    });

    expect(
      resolveAvailableRoleDefaultModelSelection({
        repoSettings: createRepoSettings({
          buildDefault: {
            runtimeKind: "codex",
            providerId: "openai",
            modelId: "gpt-5",
            variant: "",
            profileId: "",
          },
        }),
        role: "build",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBeNull();
  });

  test("resolves chat composer runtime kind from selected session, draft, role default, then repo default", () => {
    const roleDefaultSelection = {
      runtimeKind: "opencode" as const,
      providerId: "anthropic",
      modelId: "claude-sonnet",
    };

    expect(
      resolveChatComposerSelectedRuntimeKind({
        selectedSessionModel: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "gpt-5",
        },
        draftSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
        },
        roleDefaultSelection,
        repoDefaultRuntimeKind: "opencode",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBe("codex");

    expect(
      resolveChatComposerSelectedRuntimeKind({
        selectedSessionModel: null,
        draftSelection: null,
        roleDefaultSelection,
        repoDefaultRuntimeKind: "codex",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBe("opencode");

    expect(
      resolveChatComposerSelectedRuntimeKind({
        selectedSessionModel: null,
        draftSelection: null,
        roleDefaultSelection: null,
        repoDefaultRuntimeKind: "codex",
        runtimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
      }),
    ).toBeNull();
  });

  test("resolves draft selection by normalizing existing selection then falling back", () => {
    expect(
      resolvePreferredModelSelection({
        catalog: CATALOG,
        preferredSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "missing-variant",
          profileId: "hidden-subagent",
        },
        fallbackSelection: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
    });

    expect(
      resolvePreferredModelSelection({
        catalog: CATALOG,
        preferredSelection: null,
        fallbackSelection: {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet",
        },
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "anthropic",
      modelId: "claude-sonnet",
    });

    expect(
      resolvePreferredModelSelection({
        catalog: CATALOG,
        preferredSelection: null,
        fallbackSelection: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec-agent",
    });
  });

  test("resolves preferred active-session model using selected model before defaults", () => {
    expect(
      resolvePreferredModelSelection({
        catalog: CATALOG,
        preferredSelection: {
          runtimeKind: "opencode",
          providerId: "openai",
          modelId: "gpt-5",
          variant: "high",
          profileId: "spec-agent",
        },
        fallbackSelection: {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet",
        },
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
      profileId: "spec-agent",
    });

    expect(
      resolvePreferredModelSelection({
        catalog: CATALOG,
        preferredSelection: {
          runtimeKind: "opencode",
          providerId: "missing",
          modelId: "model",
        },
        fallbackSelection: null,
      }),
    ).toEqual({
      runtimeKind: "opencode",
      providerId: "openai",
      modelId: "gpt-5",
      variant: "default",
      profileId: "spec-agent",
    });
  });

  test("resolves chat composer selections for a loaded session without replacing unknown session model", () => {
    const draftSelection = {
      runtimeKind: "opencode" as const,
      providerId: "openai",
      modelId: "gpt-5",
      variant: "high",
    };
    const roleDefaultSelection = {
      runtimeKind: "opencode" as const,
      providerId: "anthropic",
      modelId: "claude-sonnet",
    };
    const unknownSessionModel = {
      runtimeKind: "opencode" as const,
      providerId: "missing",
      modelId: "missing-model",
    };

    expect(
      resolveChatComposerModelSelections({
        hasSessionTarget: true,
        sessionModelCatalog: CATALOG,
        composerCatalog: null,
        selectedSessionModel: unknownSessionModel,
        draftSelection,
        roleDefaultSelection,
        isAwaitingRepoSettingsForWorkspaceRepoPath: false,
      }),
    ).toEqual({
      selectionCatalog: CATALOG,
      selectedModelSelection: unknownSessionModel,
      selectionForNewSession: draftSelection,
    });
  });

  test("resolves chat composer selections for a new session from draft, defaults, then catalog", () => {
    const roleDefaultSelection = {
      runtimeKind: "opencode" as const,
      providerId: "anthropic",
      modelId: "claude-sonnet",
    };

    expect(
      resolveChatComposerModelSelections({
        hasSessionTarget: false,
        sessionModelCatalog: null,
        composerCatalog: CATALOG,
        selectedSessionModel: null,
        draftSelection: null,
        roleDefaultSelection,
        isAwaitingRepoSettingsForWorkspaceRepoPath: false,
      }),
    ).toEqual({
      selectionCatalog: CATALOG,
      selectedModelSelection: roleDefaultSelection,
      selectionForNewSession: roleDefaultSelection,
    });

    expect(
      resolveChatComposerModelSelections({
        hasSessionTarget: false,
        sessionModelCatalog: null,
        composerCatalog: null,
        selectedSessionModel: null,
        draftSelection: null,
        roleDefaultSelection,
        isAwaitingRepoSettingsForWorkspaceRepoPath: true,
      }),
    ).toEqual({
      selectionCatalog: null,
      selectedModelSelection: null,
      selectionForNewSession: null,
    });
  });
});
