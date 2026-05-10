import { describe, expect, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  type RepoConfig,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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

const repoConfig: RepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  defaultRuntimeKind: "codex",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: { providers: {} },
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
  test("disables the agent selector instead of hiding it when runtime profiles are unsupported", () => {
    const html = renderToStaticMarkup(
      createElement(RepositoryAgentsSection, {
        selectedRepoConfig: repoConfig,
        agentRuntimes: { ...DEFAULT_AGENT_RUNTIMES, codex: { enabled: true } },
        runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR],
        isLoadingRuntimeDefinitions: false,
        isLoadingCatalog: false,
        isLoadingSettings: false,
        isSaving: false,
        runtimeDefinitionsError: null,
        getCatalogForRuntime: () => codexCatalog,
        getCatalogErrorForRuntime: () => null,
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
  });
});
