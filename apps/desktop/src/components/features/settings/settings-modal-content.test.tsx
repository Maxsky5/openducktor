import { describe, expect, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SettingsModalContent } from "./settings-modal-content";

const createMockSnapshot = (overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot => ({
  git: { defaultMergeMethod: "merge_commit" },
  chat: { showThinkingMessages: false },
  repos: {},
  globalPromptOverrides: {},
  ...overrides,
});

const createMockController = (snapshot: SettingsSnapshot) => ({
  isLoadingSettings: false,
  isLoadingRuntimeDefinitions: false,
  isLoadingCatalog: false,
  isSaving: false,
  isPickingWorktreeBasePath: false,
  settingsError: null,
  runtimeDefinitionsError: null,
  saveError: null,
  snapshotDraft: snapshot,
  runtimeDefinitions: [],
  runtimeCheck: null,
  getCatalogForRuntime: () => null,
  getCatalogErrorForRuntime: () => null,
  isCatalogLoadingForRuntime: () => false,
  repoPaths: [],
  selectedRepoPath: null,
  selectedRepoConfig: null,
  selectedRepoWorkspace: null,
  selectedRepoDefaultWorktreeBasePath: null,
  selectedRepoEffectiveWorktreeBasePath: null,
  selectedRepoBranches: [],
  isLoadingSelectedRepoBranches: false,
  selectedRepoBranchesError: null,
  promptValidationState: {
    globalErrors: {},
    globalErrorCount: 0,
    repoErrorsByPath: {},
    repoErrorCountByPath: {},
    repoTotalErrorCount: 0,
    totalErrorCount: 0,
  },
  hasPromptValidationErrors: false,
  selectedRepoPromptValidationErrors: {},
  selectedRepoPromptValidationErrorCount: 0,
  globalPromptRoleTabErrorCounts: { shared: 0, spec: 0, planner: 0, build: 0, qa: 0 },
  selectedRepoPromptRoleTabErrorCounts: { shared: 0, spec: 0, planner: 0, build: 0, qa: 0 },
  settingsSectionErrorCountById: { general: 0, git: 0, repositories: 0, prompts: 0, chat: 0 },
  setSelectedRepoPath: () => {},
  retrySelectedRepoBranchesLoad: () => {},
  detectSelectedRepoGithubRepository: async () => null,
  updateSelectedRepoConfig: () => {},
  updateGlobalGitConfig: () => {},
  updateGlobalChatSettings: () => {},
  updateGlobalPromptOverrides: () => {},
  updateRepoPromptOverrides: () => {},
  updateSelectedRepoAgentDefault: () => {},
  clearSelectedRepoAgentDefault: () => {},
  pickWorktreeBasePath: async () => {},
  submit: async () => true,
});

describe("settings modal content", () => {
  test("renders chat section with SettingsChatSection when section is chat", () => {
    const snapshot = createMockSnapshot({ chat: { showThinkingMessages: true } });
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "chat",
        repositorySection: "configuration",
        globalPromptRoleTab: "shared",
        repoPromptRoleTab: "shared",
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
      }),
    );

    expect(html).toContain("Chat Settings");
    expect(html).toContain("Show Thinking Messages");
  });

  test("renders general section when section is general", () => {
    const snapshot = createMockSnapshot();
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "general",
        repositorySection: "configuration",
        globalPromptRoleTab: "shared",
        repoPromptRoleTab: "shared",
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
      }),
    );

    expect(html).toContain("General Settings");
  });

  test("renders prompts section when section is prompts", () => {
    const snapshot = createMockSnapshot();
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "prompts",
        repositorySection: "configuration",
        globalPromptRoleTab: "shared",
        repoPromptRoleTab: "shared",
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
      }),
    );

    expect(html).toContain("Global Prompt Overrides");
  });

  test("renders git section when section is git", () => {
    const snapshot = createMockSnapshot();
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "git",
        repositorySection: "configuration",
        globalPromptRoleTab: "shared",
        repoPromptRoleTab: "shared",
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
      }),
    );

    expect(html).toContain("Git Defaults");
  });

  test("shows loading state when settings are loading", () => {
    const controller = {
      ...createMockController(createMockSnapshot()),
      isLoadingSettings: true,
      snapshotDraft: null,
    };

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "chat",
        repositorySection: "configuration",
        globalPromptRoleTab: "shared",
        repoPromptRoleTab: "shared",
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
      }),
    );

    expect(html).toContain("Loading settings");
  });

  test("shows error state when settings fail to load", () => {
    const controller = {
      ...createMockController(createMockSnapshot()),
      settingsError: "Failed to load",
      snapshotDraft: null,
    };

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "chat",
        repositorySection: "configuration",
        globalPromptRoleTab: "shared",
        repoPromptRoleTab: "shared",
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
      }),
    );

    expect(html).toContain("Failed to load settings");
  });
});
