import { describe, expect, test } from "bun:test";
import { CODEX_RUNTIME_DESCRIPTOR, type SettingsRepoConfig } from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveRepoAgentDefaultModelPickerSelection } from "./settings-repository-agent-selection";
import { RepositoryAgentsSection } from "./settings-repository-agents-section";

const codexCatalog: AgentModelCatalog = {
  runtime: CODEX_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "codex-model-o3",
      providerId: "openai",
      providerName: "OpenAI",
      modelId: "o3",
      modelName: "o3",
      variants: ["low", "high"],
    },
  ],
  defaultModelsByProvider: { openai: "o3" },
  profiles: [],
};

const repoConfig: SettingsRepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "codex",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {
    spec: {
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "o3",
      variant: "low",
      profileId: "",
    },
  },
};

describe("RepositoryAgentsSection", () => {
  test("resolves an exact cross-runtime model pair with compatible defaults", () => {
    expect(
      resolveRepoAgentDefaultModelPickerSelection({
        currentValue: {
          runtimeKind: "opencode",
          providerId: "anthropic",
          modelId: "claude-sonnet",
          variant: "high",
          profileId: "builder",
        },
        currentRuntimeKind: "opencode",
        targetCatalog: codexCatalog,
        value: {
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "o3",
        },
      }),
    ).toEqual({
      runtimeKind: "codex",
      providerId: "openai",
      modelId: "o3",
      variant: "low",
      profileId: "",
    });
  });

  test("disables the agent selector instead of hiding it when runtime profiles are unsupported", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryAgentsSection, {
        selectedRepoConfig: repoConfig,
        availableRuntimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR],
        catalogResources: [
          {
            runtimeKind: "codex",
            catalog: codexCatalog,
            isFetching: false,
            isEnabled: true,
            error: null,
            retry: async () => {},
          },
        ],
        favoriteState: {
          favorites: [],
          isLoading: false,
          readError: null,
          isMutationPending: false,
          mutationError: null,
          canMutate: true,
          toggleFavorite: () => {},
          retryRead: () => {},
          retryMutation: () => {},
        },
        loadingState: {
          isLoadingRuntimeDefinitions: false,
          isLoadingCatalog: false,
          isLoadingSettings: false,
          isSaving: false,
        },
        runtimeDefinitionsError: null,
        runtimeAvailabilityErrors: ['Default agent runtime "Codex" is disabled.'],
        getCatalogForRuntime: () => codexCatalog,
        isCatalogLoadingForRuntime: () => false,
        onUpdateSelectedRepoConfig: () => {},
        onUpdateSelectedRepoAgentDefault: () => {},
        onClearSelectedRepoAgentDefault: () => {},
      }),
    );

    expect(html).toContain("Agent Profile");
    expect(html).toContain("Runtime does not support agent profiles");
    expect(html).toContain("disabled");
    expect(html).toContain("o3");
    expect(html).toContain("Default agent runtime &quot;Codex&quot; is disabled.");
  });
});
