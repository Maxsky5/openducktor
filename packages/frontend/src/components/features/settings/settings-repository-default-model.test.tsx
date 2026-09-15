import { describe, expect, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
  type SettingsRepoConfig,
} from "@openducktor/contracts";
import type { AgentModelCatalog } from "@openducktor/core";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RepositoryDefaultModelBlock } from "./settings-repository-default-model";

const repoConfig: SettingsRepoConfig = {
  workspaceId: "repo",
  workspaceName: "Repo",
  repoPath: "/repo",
  branchPrefix: "odt",
  defaultTargetBranch: { remote: "origin", branch: "main" },
  git: {},
  hooks: { preStart: [], postComplete: [] },
  devServers: [],
  worktreeCopyPaths: [],
  promptOverrides: {},
  agentDefaults: {},
};

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

const opencodeCatalog: AgentModelCatalog = {
  runtime: OPENCODE_RUNTIME_DESCRIPTOR,
  models: [
    {
      id: "anthropic/claude-sonnet",
      providerId: "anthropic",
      providerName: "Anthropic",
      modelId: "claude-sonnet",
      modelName: "Claude Sonnet",
      variants: ["low", "high"],
    },
  ],
  defaultModelsByProvider: { anthropic: "claude-sonnet" },
  profiles: [{ id: "build", label: "build", mode: "primary" }],
};

const favoriteState = {
  favorites: [],
  isLoading: false,
  readError: null,
  isMutationPending: false,
  mutationError: null,
  canMutate: true,
  toggleFavorite: () => {},
  retryRead: () => {},
  retryMutation: () => {},
};

const renderBlock = ({
  descriptor,
  catalog,
  defaultModel,
}: {
  descriptor: RuntimeDescriptor;
  catalog: AgentModelCatalog;
  defaultModel: SettingsRepoConfig["defaultModel"];
}): string =>
  renderToStaticMarkup(
    createElement(RepositoryDefaultModelBlock, {
      selectedRepoConfig: { ...repoConfig, defaultModel },
      availableRuntimeDefinitions: [descriptor],
      catalogResources: [
        {
          runtimeKind: descriptor.kind,
          catalog,
          isFetching: false,
          isEnabled: true,
          error: null,
          retry: async () => {},
        },
      ],
      favoriteState,
      loadingState: { isLoadingCatalog: false, isLoadingSettings: false, isSaving: false },
      getCatalogForRuntime: () => catalog,
      isCatalogLoadingForRuntime: () => false,
      onUpdateSelectedRepoConfig: () => {},
      onUpdateSelectedRepoDefaultModel: () => {},
      onClearSelectedRepoDefaultModel: () => {},
    }),
  );

const profileControlHtml = (html: string): string =>
  html.slice(html.indexOf("Agent Profile"), html.indexOf("Effort"));

const profileTriggerTag = (html: string): string => {
  const profileControl = profileControlHtml(html);
  const start = profileControl.indexOf("<button");
  return profileControl.slice(start, profileControl.indexOf(">", start) + 1);
};

describe("RepositoryDefaultModelBlock", () => {
  test("renders the profile control disabled when the runtime does not support profiles", () => {
    const html = renderBlock({
      descriptor: CODEX_RUNTIME_DESCRIPTOR,
      catalog: codexCatalog,
      defaultModel: {
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "o3",
        variant: "low",
        profileId: "",
      },
    });

    expect(profileControlHtml(html)).toContain("Runtime does not support agent profiles");
    expect(profileTriggerTag(html)).toMatch(/ disabled=""/);
  });

  test("renders the profile control enabled when the runtime supports profiles", () => {
    const html = renderBlock({
      descriptor: OPENCODE_RUNTIME_DESCRIPTOR,
      catalog: opencodeCatalog,
      defaultModel: {
        runtimeKind: "opencode",
        providerId: "anthropic",
        modelId: "claude-sonnet",
        variant: "high",
        profileId: "",
      },
    });

    expect(profileControlHtml(html)).toContain("Select agent");
    expect(profileTriggerTag(html)).not.toMatch(/ disabled=""/);
  });
});
