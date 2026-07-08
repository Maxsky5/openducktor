import { describe, expect, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type SettingsSnapshot,
} from "@openducktor/contracts";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { SettingsModalContent } from "./settings-modal-content";

const createMockSnapshot = (overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot =>
  createSettingsSnapshotFixture(overrides);

const createMockController = (snapshot: SettingsSnapshot) => ({
  isLoadingSettings: false,
  isLoadingRuntimeDefinitions: false,
  isLoadingCatalog: false,
  isSaving: false,
  settingsError: null,
  runtimeDefinitionsError: null,
  saveError: null,
  snapshotDraft: snapshot,
  runtimeDefinitions: [],
  availableRuntimeDefinitions: [],
  runtimeCheck: null,
  getCatalogForRuntime: () => null,
  getCatalogErrorForRuntime: () => null,
  isCatalogLoadingForRuntime: () => false,
  workspaces: [],
  workspaceIds: [],
  selectedWorkspaceId: null,
  selectedRepoConfig: null,
  selectedWorkspace: null,
  selectedRepoDefaultWorktreeBasePath: null,
  selectedRepoEffectiveWorktreeBasePath: null,
  selectedRepoBranches: [],
  isLoadingSelectedRepoBranches: false,
  selectedRepoBranchesError: null,
  promptValidationState: {
    globalErrors: {},
    globalErrorCount: 0,
    repoErrorsByWorkspaceId: {},
    repoErrorCountByWorkspaceId: {},
    repoTotalErrorCount: 0,
    totalErrorCount: 0,
  },
  hasPromptValidationErrors: false,
  reusablePromptValidationState: { errorsById: {}, totalErrorCount: 0 },
  hasReusablePromptValidationErrors: false,
  runtimeAvailabilityValidationState: {
    errorsByWorkspaceId: {},
    errorCountByWorkspaceId: {},
    totalErrorCount: 0,
  },
  hasRuntimeAvailabilityErrors: false,
  hasUnacknowledgedCodexDangerousSettings: false,
  requiresCodexDangerAcknowledgement: false,
  isCodexDangerAcknowledged: false,
  selectedRepoRuntimeAvailabilityErrors: [],
  selectedRepoRuntimeAvailabilityErrorCount: 0,
  hasRepoScriptValidationErrors: false,
  repoScriptValidationErrorCount: 0,
  showRepoScriptValidationErrors: false,
  selectedRepoDevServerValidationErrors: {},
  selectedRepoPromptValidationErrors: {},
  selectedRepoPromptValidationErrorCount: 0,
  globalPromptRoleTabErrorCounts: { shared: 0, spec: 0, planner: 0, build: 0, qa: 0 },
  selectedRepoPromptRoleTabErrorCounts: { shared: 0, spec: 0, planner: 0, build: 0, qa: 0 },
  settingsSectionErrorCountById: {
    general: 0,
    git: 0,
    runtimes: 0,
    repositories: 0,
    prompts: 0,
    "reusable-prompts": 0,
    appearance: 0,
    chat: 0,
    kanban: 0,
    autopilot: 0,
  },
  setSelectedWorkspaceId: () => {},
  markRepoScriptSaveAttempt: () => {},
  retrySelectedRepoBranchesLoad: () => {},
  detectSelectedRepoGithubRepository: async () => null,
  updateSelectedRepoConfig: () => {},
  updateGlobalGitConfig: () => {},
  updateGlobalGeneralSettings: () => {},
  updateGlobalChatSettings: () => {},
  updateGlobalAppearanceSettings: () => {},
  updateAgentRuntimes: () => {},
  setCodexDangerAcknowledged: () => {},
  updateReusablePrompts: () => {},
  updateGlobalKanbanSettings: () => {},
  updateGlobalAutopilotSettings: () => {},
  updateGlobalPromptOverrides: () => {},
  updateRepoPromptOverrides: () => {},
  updateSelectedRepoAgentDefault: () => {},
  clearSelectedRepoAgentDefault: () => {},
  submit: async () => true,
});

describe("settings modal content", () => {
  test("renders general section with automatic Agent Studio tab setting", () => {
    const controller = createMockController(createMockSnapshot());

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "general",
        repositorySection: "configuration",
        globalPromptRoleTab: "shared",
        repoPromptRoleTab: "shared",
        selectedReusablePromptId: null,
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("Open Agent Studio tab for background sessions");
    expect(html).toContain('aria-checked="true"');
  });

  test("renders chat section with SettingsChatSection when section is chat", () => {
    const defaultSnapshot = createMockSnapshot();
    const snapshot = createMockSnapshot({
      chat: { ...defaultSnapshot.chat, showThinkingMessages: true, expandFileDiffsByDefault: true },
    });
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "chat",
        repositorySection: "configuration",
        globalPromptRoleTab: "shared",
        repoPromptRoleTab: "shared",
        selectedReusablePromptId: null,
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("Chat Settings");
    expect(html).toContain("Show Thinking Messages");
    expect(html).not.toContain("Reusable prompts");
  });

  test("renders appearance section when section is appearance", () => {
    const snapshot = createMockSnapshot({
      appearance: { horizontalScrollbarVisibility: "hide" },
    });
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "appearance",
        repositorySection: "configuration",
        globalPromptRoleTab: "shared",
        repoPromptRoleTab: "shared",
        selectedReusablePromptId: null,
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("Appearance");
    expect(html).toContain("Horizontal Scrollbars");
    expect(html).toContain("System default");
    expect(html).toContain("Show");
    expect(html).toContain("Hide");
  });

  test("renders reusable prompts as a root section", () => {
    const snapshot = createMockSnapshot({
      reusablePrompts: [
        {
          id: "prompt-1",
          name: "review",
          description: "Review files",
          content: "Review this:\n$ARGUMENTS",
        },
      ],
    });
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "reusable-prompts",
        repositorySection: "configuration",
        globalPromptRoleTab: "shared",
        repoPromptRoleTab: "shared",
        selectedReusablePromptId: "prompt-1",
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("Reusable prompts");
    expect(html).toContain("review");
    expect(html).toContain("Review files");
  });

  test("renders OpenCode before Codex in Agent Runtimes", () => {
    const controller = {
      ...createMockController(createMockSnapshot()),
      runtimeDefinitions: [CODEX_RUNTIME_DESCRIPTOR, OPENCODE_RUNTIME_DESCRIPTOR],
      availableRuntimeDefinitions: [OPENCODE_RUNTIME_DESCRIPTOR],
    };

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "runtimes",
        repositorySection: "configuration",
        globalPromptRoleTab: "shared",
        repoPromptRoleTab: "shared",
        selectedReusablePromptId: null,
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html.indexOf("OpenCode")).toBeLessThan(html.indexOf("Codex"));
    expect(html).toContain("Local OpenCode runtime connected through the OpenDucktor MCP bridge.");
    expect(html).toContain("Codex");
    expect(html).toContain("Disabled");
    expect(html).not.toContain("Codex defaults");
  });

  test("renders kanban section when section is kanban", () => {
    const snapshot = createMockSnapshot({
      kanban: { doneVisibleDays: 7, emptyColumnDisplay: "collapsed" },
    });
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "kanban",
        repositorySection: "configuration",
        globalPromptRoleTab: "shared",
        repoPromptRoleTab: "shared",
        selectedReusablePromptId: null,
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("Kanban Settings");
    expect(html).toContain("Done tasks visible for");
    expect(html).toContain("Empty columns");
    expect(html).toContain("Choose whether empty lanes stay visible");
    expect(html).toContain('value="7"');
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
        selectedReusablePromptId: null,
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("General Settings");
  });

  test("renders autopilot section when section is autopilot", () => {
    const snapshot = createMockSnapshot();
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "autopilot",
        repositorySection: "configuration",
        globalPromptRoleTab: "shared",
        repoPromptRoleTab: "shared",
        selectedReusablePromptId: null,
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("Autopilot");
    expect(html).toContain("When a task progresses to Spec Ready");
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
        selectedReusablePromptId: null,
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
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
        selectedReusablePromptId: null,
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
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
        selectedReusablePromptId: null,
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
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
        selectedReusablePromptId: null,
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptRoleTabChange: () => {},
        onRepoPromptRoleTabChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("Failed to load settings");
  });
});
