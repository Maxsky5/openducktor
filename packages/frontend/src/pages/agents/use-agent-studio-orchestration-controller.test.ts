import { MemoryRouter } from "react-router";
import { describe, expect, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RepositoryGitProviderContext,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import { createElement, type PropsWithChildren } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChatComposer } from "@/components/features/agents/agent-chat/agent-chat-composer";
import { AgentChatSettingsProvider } from "@/components/features/agents/agent-chat/agent-chat-settings-context";
import {
  agentSessionIdentityKey,
  toAgentSessionIdentity,
} from "@openducktor/frontend-core/lib/agent-session-identity";
import { QueryProvider } from "@/test-utils/query-provider";
import {
  createAgentSessionsStore,
  toAgentSessionSummary,
} from "@openducktor/frontend-core/sessions/agent-sessions-store";
import {
  ActiveWorkspaceContext,
  RuntimeDefinitionsContext,
  WorkspaceStateContext,
} from "@/state/app-state-contexts";
import {
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { createAgentChatSendFixture } from "@/test-utils/agent-chat-send-fixture";
import { AgentChatSendProviders } from "@/test-utils/agent-chat-send-providers";
import { createAgentOperationsFixture } from "@openducktor/frontend-core/test-support/agent-operations-fixture";
import {
  createChatSettingsFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import { readyAgentSessionReadModelLoadState } from "@openducktor/frontend-core/types/agent-session-read-model";
import { agentStudioChatDraftScopeKey } from "./agent-studio-chat-draft";
import {
  createAgentSessionFixture,
  createSelectedSessionTranscriptStateFixture,
  createTaskCardFixture,
} from "./agent-studio-test-utils";
import { ROLE_OPTIONS } from "./agents-page-constants";
import { buildRoleLabelByRole } from "./agents-page-view-model";
import { buildAgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import {
  buildAgentStudioPageModelsArgs,
  resolvePullRequestReviewAvailability,
  useAgentStudioOrchestrationController,
} from "./use-agent-studio-orchestration-controller";

type BuildArgs = Parameters<typeof buildAgentStudioPageModelsArgs>[0];

const handleSelectAgentProfile = () => {};
const handleSelectVariant = () => {};
const createBaseArgs = (): BuildArgs => {
  const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
  const session = createAgentSessionFixture({
    runtimeKind: "opencode",
    externalSessionId: "session-1",
    sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
  });
  const sessionSummary = toAgentSessionSummary(session);
  const createTaskDocument = () => ({
    markdown: "# doc",
    updatedAt: "2026-02-22T10:00:00.000Z",
    isLoading: false,
    error: null,
    loaded: true,
  });
  const sessionActions = {
    handleWorkflowStepSelect: () => {},
    handleSessionSelectionChange: () => {},
    handleCreateSession: () => {},
    handlePrepareMessageFirstSession: () => {},
    handleQuickAction: () => {},
    openTaskDetails: () => {},
    isStarting: false,
    isSessionWorking: false,
    isWaitingInput: false,
    messageDelivery: createAgentChatSendFixture(),
    canUseKickoffPrompt: false,
    kickoffLabel: "Kickoff",
    canStopSession: false,
    canResumeSession: false,
    isResumingSession: false,
    resumeSessionError: null,
    persistentResumeError: null,
    onResumeSession: () => {},
    startLaunchKickoff: async () => {},
    sendAgentMessage: async () => null,
    onSubmitQuestionAnswers: async () => {},
    isSubmittingQuestionByRequestId: {},
    isSubmittingApprovalByRequestId: {},
    approvalReplyErrorByRequestId: {},
    onReplyApproval: async () => {},
    stopAgentSession: async () => {},
    loadAgentSessionHistory: async () => null,
  };

  return {
    selectedSession: buildAgentStudioSelectedSessionContext({
      taskId: "task-1",
      role: "planner",
      selectedTask: task,
      sessionsForTask: [sessionSummary],
      selectedSession: {
        preparation: { ready: true, error: null },
        identity: toAgentSessionIdentity(session),
        activityState: sessionSummary.activityState,
        selectedModel: session.selectedModel,
        loadedSession: session,
        runtimeData: {
          modelCatalog: null,
          todos: [],
          isLoadingModelCatalog: false,
          catalogError: null,
          todosError: null,
          runtimePolicyError: null,
          contextError: null,
        },
        runtimeReadiness: {
          state: "ready",
          message: null,
          isLoadingChecks: false,
          refreshChecks: async () => {},
        },
        transcriptState: createSelectedSessionTranscriptStateFixture(),
        sessionAuxiliaryError: null,
      },
      documents: {
        specDoc: createTaskDocument(),
        planDoc: createTaskDocument(),
        qaDoc: createTaskDocument(),
      },
      sessionActions,
      roleLabelByRole: buildRoleLabelByRole(ROLE_OPTIONS),
    }),
    sessionActions,
    modelSelection: {
      selectedModelSelection: null,
      speed: null,
      selectedModelDescriptor: null,
      isSelectionCatalogLoading: false,
      supportsAttachments: true,
      supportsSlashCommands: true,
      supportsFileSearch: true,
      supportsSkillReferences: false,
      supportsSubagentReferences: false,
      slashCommandCatalog: { commands: [] },
      slashCommands: [],
      slashCommandsError: null,
      isSlashCommandsLoading: false,
      skillCatalog: { skills: [] },
      skills: [],
      skillsError: null,
      isSkillsLoading: false,
      subagentCatalog: { subagents: [] },
      subagents: [],
      subagentsError: null,
      isSubagentsLoading: false,
      retrySlashCommands: null,
      retrySkills: null,
      retrySubagents: null,
      onAgentSelectorOpen: () => {},
      onVariantSelectorOpen: () => {},
      onCatalogMenuOpen: () => {},
      searchFiles: async () => [],
      agentProfileOptions: [],
      modelPicker: {
        runtimes: [],
        value: null,
        selectionPolicy: { kind: "editable" as const },
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
        onValueChange: () => {},
        onOpenChange: () => {},
      },
      variantOptions: [],
      handleSelectAgentProfile,
      handleSelectVariant,
      selectedSessionContextUsage: null,
    },
    chatSettings: createChatSettingsFixture({
      showThinkingMessages: true,
      expandFileDiffsByDefault: false,
      diffStyle: "unified",
      diffIndicators: "none",
      diffHeight: "scroll",
      lineOverflow: "scroll",
      hunkSeparators: "simple",
    }),
    runtimeDefinitions: [structuredClone(OPENCODE_RUNTIME_DESCRIPTOR)],
    composer: {
      workspaceId: "workspace-repo",
      draftScope: {
        taskId: "task-1",
        role: "planner",
        session: toAgentSessionIdentity(session),
      },
    },
  };
};

describe("buildAgentStudioPageModelsArgs", () => {
  test("maps grouped orchestration context into page-model contracts", () => {
    const baseArgs = createBaseArgs();
    const sessionIdentity = baseArgs.selectedSession.selectedSession.identity;
    if (!sessionIdentity) {
      throw new Error("Expected the base Agent Studio fixture to include a session identity.");
    }
    const mapped = buildAgentStudioPageModelsArgs(baseArgs);

    expect(mapped.selectedSession.role).toBe("planner");
    expect(mapped.selectedSession.selectedSession.transcriptState).toEqual({
      kind: "visible",
    });
    expect(mapped.selectedSession.documents.taskDocuments?.plan.document.markdown).toBe("# doc");
    expect(mapped.selectedSession.documents.defaultDocumentKind).toBe("plan");
    expect(mapped.selectedSession.selectedSession.runtimeReadiness.state).toBe("ready");
    expect(mapped.modelSelection.onSelectAgent).toBe(handleSelectAgentProfile);
    expect(mapped.modelSelection.onSelectVariant).toBe(handleSelectVariant);
    expect(mapped.chatSettings).toEqual(baseArgs.chatSettings);
    expect(mapped.composer.draftScope).toEqual({
      taskId: "task-1",
      role: "planner",
      session: sessionIdentity,
    });
    expect(
      agentStudioChatDraftScopeKey(mapped.composer.workspaceId, mapped.composer.draftScope),
    ).toBe(`workspace-repo:task-1:planner:${agentSessionIdentityKey(sessionIdentity)}`);
  });

  test("forwards selected-session runtime state without recomputing it", () => {
    const baseArgs = createBaseArgs();
    const failed = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      selectedSession: {
        ...baseArgs.selectedSession,
        selectedSession: {
          ...baseArgs.selectedSession.selectedSession,
          transcriptState: createSelectedSessionTranscriptStateFixture({
            kind: "failed",
            message: "Selected session failed",
          }),
        },
      },
    });

    expect(failed.selectedSession.selectedSession.transcriptState).toEqual({
      kind: "failed",
      message: "Selected session failed",
    });
  });
});

describe("task chat speed", () => {
  test.each([
    { runtime: CODEX_RUNTIME_DESCRIPTOR, speed: undefined, label: "Standard" },
    { runtime: CODEX_RUNTIME_DESCRIPTOR, speed: "priority", label: "Fast" },
    { runtime: CLAUDE_RUNTIME_DESCRIPTOR, speed: undefined, label: "Standard" },
    { runtime: CLAUDE_RUNTIME_DESCRIPTOR, speed: "fast", label: "Fast" },
    { runtime: OPENCODE_RUNTIME_DESCRIPTOR, speed: undefined, label: null },
  ])("renders $runtime.kind composer speed as $label", ({ runtime, speed, label }) => {
    const base = createBaseArgs();
    const selectedModel = {
      runtimeKind: runtime.kind,
      providerId: runtime.kind,
      modelId: "model",
      speed,
    };
    const session = createAgentSessionFixture({
      runtimeKind: runtime.kind,
      selectedModel,
      sessionAssociation: { kind: "workflow", taskId: "task-1", role: "planner" },
    });
    const summary = toAgentSessionSummary(session);
    const selectedSession = {
      ...base.selectedSession.selectedSession,
      identity: toAgentSessionIdentity(session),
      loadedSession: session,
      selectedModel,
      runtimeData: {
        ...base.selectedSession.selectedSession.runtimeData,
        modelCatalog: {
          runtime,
          models: [
            {
              id: "model",
              providerId: runtime.kind,
              providerName: runtime.label,
              modelId: "model",
              modelName: "Model",
              variants: [],
              speedLevels: [{ id: runtime.kind === "codex" ? "priority" : "fast", label: "Fast" }],
            },
          ],
          defaultModelsByProvider: { [runtime.kind]: "model" },
        },
      },
    };
    const operations = createAgentOperationsFixture();
    const args: Parameters<typeof useAgentStudioOrchestrationController>[0] = {
      activeWorkspaceId: "workspace-repo",
      workspaceRepoPath: "/repo",
      branches: [],
      runtimeDefinitions: [runtime],
      repoSettings: null,
      gitProviderContext: undefined,
      gitProviderReadError: null,
      selection: {
        routeSessionResolution: { kind: "found", session: summary },
        selectedSessionFromRoute: summary,
        taskId: "task-1",
        selectedTask: base.selectedSession.selectedTask,
        sessionsForTask: [summary],
        resolvedRouteSession: summary,
        queryUpdate: null,
        view: {
          taskId: "task-1",
          selectedTask: base.selectedSession.selectedTask,
          sessionsForTask: [summary],
          isTaskReady: true,
          role: "planner",
          launchActionId: "planner_initial",
          selectedSession,
        },
      },
      composer: {
        ...base.composer,
        draftScope: { taskId: "task-1", role: "planner", session: selectedSession.identity },
      },
      actions: {
        ...operations,
        scheduleQueryUpdate: () => {},
        selectAgentStudioSelection: () => {},
        openTaskDetails: () => {},
        assertCanPrepareSession: () => {},
        runSessionStartWorkflow: async () => {
          throw new Error("Unexpected session start");
        },
      },
      taskExecutionFilePreview: {
        model: {
          selectedFile: null,
          previewSessionKey: 0,
          preservePreviousSnapshot: false,
          hasPendingDiscard: false,
          isApplyingTransition: false,
          onClose: () => {},
          onLeavePolicyChange: () => {},
          onKeepEditing: () => {},
          onDiscard: () => {},
        },
        onSelectFile: () => false,
        requestContextTransition: () => {},
      },
    };
    const Composer = () => {
      const { agentChatModel } = useAgentStudioOrchestrationController(args);
      if (label === null) expect(agentChatModel.composer.speed).toBeNull();
      return createElement(
        AgentChatSettingsProvider,
        { value: agentChatModel.chatSettings },
        createElement(AgentChatComposer, { model: agentChatModel.composer }),
      );
    };
    const html = renderToStaticMarkup(
      createElement(TaskChatProviders, { runtime }, createElement(Composer)),
    );
    const container = document.createElement("div");
    container.innerHTML = html;
    if (label === null) {
      expect(container.querySelector('[aria-label^="Speed:"]')).toBeNull();
    } else {
      expect(container.querySelector(`[aria-label="Speed: ${label}"]`)).not.toBeNull();
    }
  });
});

function TaskChatProviders({
  runtime,
  children,
}: PropsWithChildren<{ runtime: RuntimeDescriptor }>) {
  return createElement(
    QueryProvider,
    null,
    createElement(
      WorkspaceStateContext.Provider,
      { value: createWorkspaceStateFixture() },
      createElement(
        RuntimeDefinitionsContext.Provider,
        {
          value: {
            runtimeDefinitions: [runtime],
            availableRuntimeDefinitions: [runtime],
            agentRuntimes: DEFAULT_AGENT_RUNTIMES,
            isLoadingRuntimeDefinitions: false,
            runtimeDefinitionsError: null,
            isLoadingRuntimeSettings: false,
            runtimeSettingsError: null,
            hasRuntimeSettingsSnapshot: true,
            refreshRuntimeSettings: async () => {},
            refreshRuntimeDefinitions: async () => [runtime],
            loadRepoRuntimeCatalog: async () => {
              throw new Error("Unexpected catalog load");
            },
            loadRepoRuntimeFileSearch: async () => [],
          },
        },
        createElement(
          AgentSessionReadModelStateContext.Provider,
          {
            value: {
              sessionReadModelLoadState: readyAgentSessionReadModelLoadState("/repo"),
              reloadSessionReadModel: () => {},
              getSessionFault: () => null,
              workspaceSessionRecordsError: null,
            },
          },
          createElement(
            ActiveWorkspaceContext.Provider,
            { value: { activeWorkspace: null, setActiveWorkspace: () => {} } },
            createElement(
              AgentSessionsContext.Provider,
              { value: createAgentSessionsStore() },
              createElement(
                AgentChatSendProviders,
                null,
                createElement(MemoryRouter, null, children),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}

describe("resolvePullRequestReviewAvailability", () => {
  test("keeps review visible but unavailable when the provider refresh fails", () => {
    const gitProviderContext = {
      descriptor: {
        id: "github",
        label: "GitHub",
        description: "GitHub provider.",
        capabilities: {
          supportsPullRequests: true,
          supportsPullRequestReview: true,
        },
      },
      config: { id: "github", enabled: true, autoDetected: false },
      health: {
        providerId: "github",
        enabled: true,
        available: true,
        executablePath: "gh",
        version: "1.0.0",
        authenticated: true,
        account: "test",
        repositoryMappingValid: true,
      },
    } satisfies NonNullable<RepositoryGitProviderContext>;

    expect(
      resolvePullRequestReviewAvailability({
        gitProviderContext,
        gitProviderReadError: "Could not load the current Git provider: connection failed",
        linkedPullRequest: {
          providerId: "github",
          number: 7,
          url: "https://example.com/pulls/7",
          state: "open",
          createdAt: "2026-09-03T10:00:00.000Z",
          updatedAt: "2026-09-03T10:00:00.000Z",
        },
      }),
    ).toEqual({
      canShowPullRequestReview: true,
      hasLinkedPullRequest: true,
      unavailableReason: "Could not load the current Git provider: connection failed",
    });
  });

  test("keeps review visible but unavailable when the initial provider read fails", () => {
    expect(
      resolvePullRequestReviewAvailability({
        gitProviderContext: undefined,
        gitProviderReadError: "Could not load the current Git provider: connection failed",
        linkedPullRequest: {
          providerId: "github",
          number: 7,
          url: "https://example.com/pulls/7",
          state: "open",
          createdAt: "2026-09-03T10:00:00.000Z",
          updatedAt: "2026-09-03T10:00:00.000Z",
        },
      }),
    ).toEqual({
      canShowPullRequestReview: true,
      hasLinkedPullRequest: true,
      unavailableReason: "Could not load the current Git provider: connection failed",
    });
  });

  test("hides review for a linked Pull Request when the provider does not support review", () => {
    const gitProviderContext = {
      descriptor: {
        id: "fake",
        label: "Fake Git",
        description: "Fake provider without Pull Request review.",
        capabilities: {
          supportsPullRequests: true,
          supportsPullRequestReview: false,
        },
      },
      config: { id: "fake", enabled: true, autoDetected: false },
      health: {
        providerId: "fake",
        enabled: true,
        available: true,
        executablePath: "fake-git",
        version: "1.0.0",
        authenticated: true,
        account: "test",
        repositoryMappingValid: true,
      },
    } satisfies NonNullable<RepositoryGitProviderContext>;

    expect(
      resolvePullRequestReviewAvailability({
        gitProviderContext,
        gitProviderReadError: "Could not load the current Git provider: connection failed",
        linkedPullRequest: {
          providerId: "fake",
          number: 7,
          url: "https://example.com/pulls/7",
          state: "open",
          createdAt: "2026-09-03T10:00:00.000Z",
          updatedAt: "2026-09-03T10:00:00.000Z",
        },
      }),
    ).toEqual({
      canShowPullRequestReview: false,
      hasLinkedPullRequest: true,
      unavailableReason: null,
    });
  });
});
