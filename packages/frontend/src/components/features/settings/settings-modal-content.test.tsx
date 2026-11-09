import { PROMPT_HOME_VIEW } from "./settings-prompt-owners";
import { WorkflowTestProvider } from "@/test-utils/workflow-provider";
import { describe, expect, test } from "bun:test";
import {
  CODEX_RUNTIME_DESCRIPTOR,
  GITHUB_PROVIDER_DESCRIPTOR,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepositoryGitProviderContext,
  type SettingsSnapshot,
} from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { act, createElement, useState } from "react";
import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { QueryProvider } from "@/test-utils/query-provider";
import { repositoryGitProviderContextQueryKeys } from "@openducktor/frontend-core/queries/git-provider-context";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import {
  createRepoSettingsConfigFixture,
  createSettingsSnapshotFixture,
  createWorkspaceRecordFixture,
} from "@/test-utils/shared-test-fixtures";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { SettingsModalContent } from "./settings-modal-content";

enableReactActEnvironment();

const createMockSnapshot = (overrides: Partial<SettingsSnapshot> = {}): SettingsSnapshot =>
  createSettingsSnapshotFixture(overrides);

const createMockController = (snapshot: SettingsSnapshot) => ({
  customAgentRoleValidationState: { errorsById: {}, totalErrorCount: 0 },
  updateCustomAgentRoles: () => {},
  discardDraft: () => {},
  retainDraft: () => {},
  isLoadingSettings: false,
  isLoadingRuntimeDefinitions: false,
  isLoadingRuntimeExecutables: false,
  isCheckingRuntimeExecutables: false,
  isLoadingCatalog: false,
  isSaving: false,
  runtimeReview: null,
  confirmRuntimeReview: () => {},
  cancelRuntimeReview: () => {},
  settingsError: null,
  runtimeDefinitionsError: null,
  runtimeExecutablesError: null,
  runtimeDiscoveryError: null,
  runtimeExecutableValidation: {
    results: [],
    checkingRuntimeKinds: [],
    error: null,
    refetch: async () => {},
  },
  saveError: null,
  snapshotDraft: snapshot,
  runtimeDefinitions: [],
  availableRuntimeDefinitions: [],
  getCatalogForRuntime: () => null,
  getCatalogErrorForRuntime: () => null,
  isCatalogLoadingForRuntime: () => false,
  catalogResources: [],
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
  workspaces: [],
  workspaceIds: [],
  selectedWorkspaceId: null,
  selectedRepoConfig: null,
  savedSelectedRepoGitProvider: null,
  requiredWorkspaceSelectionUnresolved: false,
  requiredWorkspaceRepoPath: null,
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
    firstErrorPlace: null,
  },
  openCodePermissionErrorCount: 0,
  hasPromptValidationErrors: false,
  reusablePromptValidationState: { errorsById: {}, totalErrorCount: 0 },
  hasReusablePromptValidationErrors: false,
  runtimeAvailabilityValidationState: {
    warningsByWorkspaceId: {},
    runtimeExecutableErrors: [],
    totalErrorCount: 0,
  },
  hasRuntimeAvailabilityErrors: false,
  hasUnacknowledgedCodexDangerousSettings: false,
  claudeSettingsSaveError: null,
  requiresClaudeDangerAcknowledgement: false,
  isClaudeDangerAcknowledged: false,
  setClaudeDangerAcknowledged: () => {},
  requiresCodexDangerAcknowledgement: false,
  isCodexDangerAcknowledged: false,
  selectedRepoModelWarnings: [],
  selectedRepoPromptValidationErrors: {},
  selectedRepoPromptValidationErrorCount: 0,
  settingsSectionErrorCountById: {
    general: 0,
    "remote-access": 0,
    git: 0,
    runtimes: 0,
    repositories: 0,
    prompts: 0,
    "reusable-prompts": 0,
    "custom-agent-roles": 0,
    appearance: 0,
    chat: 0,
    notifications: 0,
    kanban: 0,
    autopilot: 0,
  },
  setSelectedWorkspaceId: () => {},
  retrySelectedRepoBranchesLoad: () => {},
  retrySettings: () => {},
  retryRuntimeDefinitions: async () => [],
  checkRuntimeExecutablesAgain: async () => {},
  detectSelectedRepoGithubRepository: async () => null,
  setGitProviderValidationErrorCount: () => {},
  updateSelectedRepoConfig: () => {},
  updateGlobalGitConfig: () => {},
  updateGlobalSystemSettings: () => {},
  updateGlobalGeneralSettings: () => {},
  updateGlobalChatSettings: () => {},
  updateNotificationSettings: () => {},
  updateGlobalAppearanceSettings: () => {},
  updateAgentRuntimes: () => {},
  setCodexDangerAcknowledged: () => {},
  updateReusablePrompts: () => {},
  updateGlobalKanbanSettings: () => {},
  updateGlobalAutopilotSettings: () => {},
  savedAutopilotError: null,
  updateGlobalPromptLayers: () => {},
  updateRepoPromptLayers: () => {},
  updateSelectedRepoAgentDefault: () => {},
  clearSelectedRepoAgentDefault: () => {},
  updateSelectedRepoDefaultModel: () => {},
  clearSelectedRepoDefaultModel: () => {},
  submit: async () => true,
  submitSection: async () => true,
});

describe("settings modal content", () => {
  test("keeps a removed workspace draft selectable and its text available to copy", async () => {
    const liveWorkspace = createWorkspaceRecordFixture({
      workspaceId: "live",
      workspaceName: "Live repository",
    });
    const snapshot = createMockSnapshot({
      workspaces: {
        live: {
          ...createRepoSettingsConfigFixture("live", "/live"),
          workspaceName: "Live repository",
        },
        removed: {
          ...createRepoSettingsConfigFixture("removed", "/removed"),
          workspaceName: "Removed repository",
          hooks: { beforeWorktreeRemoval: ["UNSAVED cleanup command"] },
        },
      },
    });
    const Wrapper = () => {
      const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("removed");
      return createElement(SettingsModalContent, {
        section: "repositories",
        repositorySection: "scripts",
        globalPromptView: PROMPT_HOME_VIEW,
        repoPromptView: PROMPT_HOME_VIEW,
        selectedReusablePromptId: null,
        selectedCustomAgentRoleId: null,
        onSelectedCustomAgentRoleIdChange: () => {},
        isInteractionDisabled: false,
        controller: {
          ...createMockController(snapshot),
          workspaces: [liveWorkspace],
          workspaceIds: ["live", "removed"],
          selectedWorkspaceId,
          selectedWorkspace: selectedWorkspaceId === "live" ? liveWorkspace : null,
          selectedRepoConfig: snapshot.workspaces[selectedWorkspaceId] ?? null,
          setSelectedWorkspaceId,
        },
        onRepositorySectionChange: () => {},
        onGlobalPromptViewChange: () => {},
        onRepoPromptViewChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      });
    };
    const rendered = render(createElement(QueryProvider, null, createElement(Wrapper)));

    try {
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", { name: "Removed repository (unavailable draft)" }),
        );
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("option", { name: "Live repository" }));
      });
      expect(screen.queryByRole("alert")).toBeNull();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Live repository" }));
      });
      await act(async () => {
        fireEvent.click(
          screen.getByRole("option", { name: "Removed repository (unavailable draft)" }),
        );
      });

      const cleanupField = screen.getByLabelText<HTMLTextAreaElement>(
        "Before worktree removal script (one command per line)",
      );
      expect(cleanupField.value).toBe("UNSAVED cleanup command");
      expect(cleanupField.disabled).toBe(false);
      expect(screen.getByRole("alert").textContent).toContain("Copy any text you need");
      expect(screen.getByRole("alert").textContent).toContain("Cancel to discard");
    } finally {
      rendered.unmount();
    }
  });

  test("renders repository scripts separately from repository configuration", () => {
    const snapshot = createMockSnapshot({
      workspaces: {
        repo: {
          workspaceId: "repo",
          workspaceName: "Repo",
          repoPath: "/repo",
          branchPrefix: "odt",
          defaultTargetBranch: { remote: "origin", branch: "main" },
          git: {},
          hooks: { beforeWorktreeRemoval: ["bun run clean"] },
          actions: {
            items: [
              {
                id: "test",
                icon: "test",
                name: "Test",
                command: "bun test",
                runOnWorktreeCreate: false,
                waitBeforeAgentStart: false,
              },
            ],
            defaultActionId: "test",
          },
          worktreeCopyPaths: [".env"],
          promptOverrides: {},
          promptAppends: {},
          agentDefaults: {},
        },
      },
    });
    const selectedRepoConfig = snapshot.workspaces.repo ?? null;
    const controller = {
      ...createMockController(snapshot),
      workspaceIds: ["repo"],
      selectedWorkspaceId: "repo",
      selectedRepoConfig,
    };
    const baseProps = {
      section: "repositories" as const,
      globalPromptView: PROMPT_HOME_VIEW,
      repoPromptView: PROMPT_HOME_VIEW,
      selectedReusablePromptId: null,
      selectedCustomAgentRoleId: null,
      onSelectedCustomAgentRoleIdChange: () => {},
      isInteractionDisabled: false,
      controller,
      onRepositorySectionChange: () => {},
      onGlobalPromptViewChange: () => {},
      onRepoPromptViewChange: () => {},
      onSelectedReusablePromptIdChange: () => {},
    };

    const scriptsHtml = renderToStaticMarkup(
      createElement(
        QueryProvider,
        null,
        createElement(SettingsModalContent, { ...baseProps, repositorySection: "scripts" }),
      ),
    );
    const configurationHtml = renderToStaticMarkup(
      createElement(
        QueryProvider,
        null,
        createElement(SettingsModalContent, { ...baseProps, repositorySection: "configuration" }),
      ),
    );

    expect(scriptsHtml).toContain("Actions are repository commands");
    expect(scriptsHtml).toContain("Before worktree removal script");
    expect(scriptsHtml).toContain("Files copied to worktrees");
    expect(configurationHtml).not.toContain("Actions are repository commands");
    expect(configurationHtml).not.toContain("Before worktree removal script");
    expect(configurationHtml).not.toContain("Files copied to worktrees");
  });

  test("does not show saved provider health for an unsaved repository", () => {
    const savedSnapshot = createMockSnapshot();
    savedSnapshot.workspaces.repo = {
      workspaceId: "repo",
      workspaceName: "Repo",
      repoPath: "/repo",
      branchPrefix: "odt",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      git: {
        provider: {
          id: "github",
          enabled: true,
          autoDetected: false,
          repository: { host: "github.com", owner: "openai", name: "saved" },
        },
      },
      hooks: { beforeWorktreeRemoval: [] },
      actions: { items: [], defaultActionId: null },
      worktreeCopyPaths: [],
      promptOverrides: {},
      promptAppends: {},
      agentDefaults: {},
    };
    const draftSnapshot = structuredClone(savedSnapshot);
    const draftRepository = draftSnapshot.workspaces.repo!.git.provider!.repository!;
    if (!("name" in draftRepository)) throw new Error("Expected a named repository.");
    draftRepository.name = "draft";
    const workspace = {
      workspaceId: "repo",
      workspaceName: "Repo",
      abbreviation: null,
      tileColor: null,
      repoPath: "/repo",
      isActive: true,
      hasConfig: true,
      configuredWorktreeBasePath: null,
      defaultWorktreeBasePath: "/tmp/worktrees",
      effectiveWorktreeBasePath: "/tmp/worktrees",
    };
    const controller = {
      ...createMockController(draftSnapshot),
      workspaces: [workspace],
      workspaceIds: ["repo"],
      selectedWorkspaceId: "repo",
      selectedWorkspace: workspace,
      selectedRepoConfig: draftSnapshot.workspaces.repo!,
    };
    const connection = createTestClientConnection();
    const { queryClient } = connection;
    queryClient.setQueryData(settingsSnapshotQueryOptions().queryKey, savedSnapshot);
    queryClient.setQueryData(
      repositoryGitProviderContextQueryKeys.repo({ workspaceId: "repo", repoPath: "/repo" }),
      (): RepositoryGitProviderContext => ({
        descriptor: GITHUB_PROVIDER_DESCRIPTOR,
        config: savedSnapshot.workspaces.repo!.git.provider!,
        health: {
          providerId: "github",
          enabled: true,
          available: true,
          executablePath: "gh",
          version: "gh version 2.73.0",
          authenticated: true,
          account: "octocat",
          repositoryMappingValid: true,
        },
      }),
    );

    const html = renderToStaticMarkup(
      createElement(
        QueryProvider,
        { connection },
        createElement(SettingsModalContent, {
          section: "repositories",
          repositorySection: "git",
          globalPromptView: PROMPT_HOME_VIEW,
          repoPromptView: PROMPT_HOME_VIEW,
          selectedReusablePromptId: null,
          selectedCustomAgentRoleId: null,
          onSelectedCustomAgentRoleIdChange: () => {},
          isInteractionDisabled: false,
          controller,
          onRepositorySectionChange: () => {},
          onGlobalPromptViewChange: () => {},
          onRepoPromptViewChange: () => {},
          onSelectedReusablePromptIdChange: () => {},
        }),
      ),
    );

    expect(html).toContain("Save settings to check GitHub health.");
    expect(html).not.toContain("GitHub pull requests are ready");
    expect(html).not.toContain("CLI installed");
  });

  test("shows an actionable state instead of falling back from a required repository", () => {
    const snapshot = createMockSnapshot();
    const controller = {
      ...createMockController(snapshot),
      requiredWorkspaceSelectionUnresolved: true,
      requiredWorkspaceRepoPath: "/missing/repo",
    };
    const html = renderToStaticMarkup(
      createElement(
        QueryProvider,
        null,
        createElement(SettingsModalContent, {
          section: "repositories",
          repositorySection: "scripts",
          globalPromptView: PROMPT_HOME_VIEW,
          repoPromptView: PROMPT_HOME_VIEW,
          selectedReusablePromptId: null,
          selectedCustomAgentRoleId: null,
          onSelectedCustomAgentRoleIdChange: () => {},
          isInteractionDisabled: false,
          controller,
          onRepositorySectionChange: () => {},
          onGlobalPromptViewChange: () => {},
          onRepoPromptViewChange: () => {},
          onSelectedReusablePromptIdChange: () => {},
        }),
      ),
    );

    expect(html).toContain("Add a repository first");
    expect(html).not.toContain("/missing/repo");
    expect(html).not.toContain("Choose a repository explicitly or close Settings");
    expect(html).not.toContain("Select a repository to edit repository scripts");
  });

  test("renders general settings without the obsolete task-tab preference", () => {
    const controller = createMockController(createMockSnapshot());

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "general",
        repositorySection: "configuration",
        globalPromptView: PROMPT_HOME_VIEW,
        repoPromptView: PROMPT_HOME_VIEW,
        selectedReusablePromptId: null,
        selectedCustomAgentRoleId: null,
        onSelectedCustomAgentRoleIdChange: () => {},
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptViewChange: () => {},
        onRepoPromptViewChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("General settings");
    expect(html).not.toContain("Open a task tab for background sessions");
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
        globalPromptView: PROMPT_HOME_VIEW,
        repoPromptView: PROMPT_HOME_VIEW,
        selectedReusablePromptId: null,
        selectedCustomAgentRoleId: null,
        onSelectedCustomAgentRoleIdChange: () => {},
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptViewChange: () => {},
        onRepoPromptViewChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("Session settings");
    expect(html).toContain("Show thinking messages");
    expect(html).not.toContain("Reusable prompts");
  });

  test("renders appearance section when section is appearance", () => {
    const snapshot = createMockSnapshot({
      appearance: { horizontalScrollbarVisibility: "hide", sidebarSessionGrouping: "task" },
    });
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(
        QueryProvider,
        null,
        createElement(
          ThemeProvider,
          null,
          createElement(SettingsModalContent, {
            section: "appearance",
            repositorySection: "configuration",
            globalPromptView: PROMPT_HOME_VIEW,
            repoPromptView: PROMPT_HOME_VIEW,
            selectedReusablePromptId: null,
            selectedCustomAgentRoleId: null,
            onSelectedCustomAgentRoleIdChange: () => {},
            isInteractionDisabled: false,
            controller,
            onRepositorySectionChange: () => {},
            onGlobalPromptViewChange: () => {},
            onRepoPromptViewChange: () => {},
            onSelectedReusablePromptIdChange: () => {},
          }),
        ),
      ),
    );

    expect(html).toContain("Appearance");
    expect(html).toContain("Preferred Open In tool");
    expect(html).toContain("Theme");
    expect(html).toContain("Horizontal scrollbars");
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
        globalPromptView: PROMPT_HOME_VIEW,
        repoPromptView: PROMPT_HOME_VIEW,
        selectedReusablePromptId: "prompt-1",
        selectedCustomAgentRoleId: null,
        onSelectedCustomAgentRoleIdChange: () => {},
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptViewChange: () => {},
        onRepoPromptViewChange: () => {},
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
      createElement(
        QueryProvider,
        null,
        createElement(SettingsModalContent, {
          section: "runtimes",
          repositorySection: "configuration",
          globalPromptView: PROMPT_HOME_VIEW,
          repoPromptView: PROMPT_HOME_VIEW,
          selectedReusablePromptId: null,
          selectedCustomAgentRoleId: null,
          onSelectedCustomAgentRoleIdChange: () => {},
          isInteractionDisabled: false,
          controller,
          onRepositorySectionChange: () => {},
          onGlobalPromptViewChange: () => {},
          onRepoPromptViewChange: () => {},
          onSelectedReusablePromptIdChange: () => {},
        }),
      ),
    );

    expect(html.indexOf("OpenCode")).toBeLessThan(html.indexOf("Codex"));
    expect(html).not.toContain(
      "Local OpenCode runtime connected through the OpenDucktor MCP bridge.",
    );
    expect(html).toContain("Codex");
    expect(html).toContain("Disabled");
    expect(html).not.toContain("Codex defaults");
  });

  test("renders kanban section when section is kanban", () => {
    const snapshot = createMockSnapshot({
      kanban: { doneVisibleDays: 7, emptyColumnDisplay: "collapsed", taskCardView: "compact" },
    });
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "kanban",
        repositorySection: "configuration",
        globalPromptView: PROMPT_HOME_VIEW,
        repoPromptView: PROMPT_HOME_VIEW,
        selectedReusablePromptId: null,
        selectedCustomAgentRoleId: null,
        onSelectedCustomAgentRoleIdChange: () => {},
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptViewChange: () => {},
        onRepoPromptViewChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("Kanban settings");
    expect(html).toContain("Done tasks visible for");
    expect(html).toContain("Empty columns");
    expect(html).toContain("Show empty columns, hide them");
    expect(html).toContain('value="7"');
  });

  test("renders general section when section is general", () => {
    const snapshot = createMockSnapshot();
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "general",
        repositorySection: "configuration",
        globalPromptView: PROMPT_HOME_VIEW,
        repoPromptView: PROMPT_HOME_VIEW,
        selectedReusablePromptId: null,
        selectedCustomAgentRoleId: null,
        onSelectedCustomAgentRoleIdChange: () => {},
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptViewChange: () => {},
        onRepoPromptViewChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("General settings");
  });

  test("renders autopilot section when section is autopilot", () => {
    const snapshot = createMockSnapshot();
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(
        QueryProvider,
        null,
        createElement(SettingsModalContent, {
          section: "autopilot",
          repositorySection: "configuration",
          globalPromptView: PROMPT_HOME_VIEW,
          repoPromptView: PROMPT_HOME_VIEW,
          selectedReusablePromptId: null,
          selectedCustomAgentRoleId: null,
          onSelectedCustomAgentRoleIdChange: () => {},
          isInteractionDisabled: false,
          controller,
          onRepositorySectionChange: () => {},
          onGlobalPromptViewChange: () => {},
          onRepoPromptViewChange: () => {},
          onSelectedReusablePromptIdChange: () => {},
        }),
      ),
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
        globalPromptView: PROMPT_HOME_VIEW,
        repoPromptView: PROMPT_HOME_VIEW,
        selectedReusablePromptId: null,
        selectedCustomAgentRoleId: null,
        onSelectedCustomAgentRoleIdChange: () => {},
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptViewChange: () => {},
        onRepoPromptViewChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("System prompts");
    expect(html).toContain("Agent roles");
    expect(html).toContain("Spec, Plan, Build");
  });

  test("renders git section when section is git", () => {
    const snapshot = createMockSnapshot();
    const controller = createMockController(snapshot);

    const html = renderToStaticMarkup(
      createElement(SettingsModalContent, {
        section: "git",
        repositorySection: "configuration",
        globalPromptView: PROMPT_HOME_VIEW,
        repoPromptView: PROMPT_HOME_VIEW,
        selectedReusablePromptId: null,
        selectedCustomAgentRoleId: null,
        onSelectedCustomAgentRoleIdChange: () => {},
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptViewChange: () => {},
        onRepoPromptViewChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("Git defaults");
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
        globalPromptView: PROMPT_HOME_VIEW,
        repoPromptView: PROMPT_HOME_VIEW,
        selectedReusablePromptId: null,
        selectedCustomAgentRoleId: null,
        onSelectedCustomAgentRoleIdChange: () => {},
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptViewChange: () => {},
        onRepoPromptViewChange: () => {},
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
        globalPromptView: PROMPT_HOME_VIEW,
        repoPromptView: PROMPT_HOME_VIEW,
        selectedReusablePromptId: null,
        selectedCustomAgentRoleId: null,
        onSelectedCustomAgentRoleIdChange: () => {},
        isInteractionDisabled: false,
        controller,
        onRepositorySectionChange: () => {},
        onGlobalPromptViewChange: () => {},
        onRepoPromptViewChange: () => {},
        onSelectedReusablePromptIdChange: () => {},
      }),
    );

    expect(html).toContain("Failed to load settings");
  });
});

const renderToStaticMarkup = (element: Parameters<typeof renderMarkup>[0]) =>
  renderMarkup(<WorkflowTestProvider>{element}</WorkflowTestProvider>);
