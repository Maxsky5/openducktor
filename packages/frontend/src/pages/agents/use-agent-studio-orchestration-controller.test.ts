import { MemoryRouter } from "react-router";
import { describe, expect, mock, test } from "bun:test";
import {
  CLAUDE_RUNTIME_DESCRIPTOR,
  CODEX_RUNTIME_DESCRIPTOR,
  DEFAULT_AGENT_RUNTIMES,
  OPENCODE_RUNTIME_DESCRIPTOR,
  type RuntimeDescriptor,
} from "@openducktor/contracts";
import { createElement, type PropsWithChildren } from "react";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { documentQueryKeys } from "@openducktor/frontend-core/queries/documents";
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
} from "@openducktor/frontend-core/app-state/app-state-contexts";
import { WorkspaceStateContext } from "@/state/app-state-contexts";
import {
  AgentSessionReadModelStateContext,
  AgentSessionsContext,
} from "@openducktor/frontend-core/sessions/session-contexts";
import { createAgentChatSendFixture } from "@openducktor/frontend-core/test-support/agent-chat-send-fixture";
import { AgentChatSendProviders } from "@openducktor/frontend-core/test-support/agent-chat-send-providers";
import { createAgentOperationsFixture } from "@openducktor/frontend-core/test-support/agent-operations-fixture";
import {
  createChatSettingsFixture,
  createHostRuntimeStatusContextValue,
  createHostRuntimeStatusFixture,
  createRuntimeCatalogFixture,
  createSettingsSnapshotFixture,
  createWorkspaceStateFixture,
} from "@/test-utils/shared-test-fixtures";
import type { RuntimeDefinitionsContextValue } from "@openducktor/frontend-core/app-state/app-state-contexts";
import type { HostRuntimeStatusContextValue } from "@/types/state-slices";
import { readyAgentSessionReadModelLoadState } from "@openducktor/frontend-core/types/agent-session-read-model";
import { agentStudioChatDraftScopeKey } from "@openducktor/frontend-core/sessions/composer/agent-studio-chat-draft";
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

type ControllerArgs = Parameters<typeof useAgentStudioOrchestrationController>[0];

const createControllerArgs = (
  base: BuildArgs,
  runtime: RuntimeDescriptor,
  selectedSession = base.selectedSession.selectedSession,
): ControllerArgs => {
  const summary = selectedSession.loadedSession
    ? toAgentSessionSummary(selectedSession.loadedSession)
    : base.selectedSession.sessionsForTask[0]!;
  const operations = createAgentOperationsFixture();
  return {
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
      draftScope: {
        taskId: "task-1",
        role: "planner",
        session: selectedSession.identity,
      },
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
};

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
      sessionAssociation: {
        kind: "workflow",
        taskId: "task-1",
        role: "planner",
      },
    });
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
              speedLevels: [
                {
                  id: runtime.kind === "codex" ? "priority" : "fast",
                  label: "Fast",
                },
              ],
            },
          ],
          defaultModelsByProvider: { [runtime.kind]: "model" },
        },
      },
    };
    const args = createControllerArgs(base, runtime, selectedSession);
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

describe("task chat drafts", () => {
  test("uses the chosen draft runtime when the default runtime is unavailable", async () => {
    const base = createBaseArgs();
    const selectedSession = {
      ...base.selectedSession.selectedSession,
      identity: null,
      selectedModel: null,
      loadedSession: null,
      runtimeReadiness: {
        ...base.selectedSession.selectedSession.runtimeReadiness,
        state: "blocked" as const,
        message: "OpenCode is unavailable.",
      },
      transcriptState: { kind: "runtime_waiting" } as const,
    };
    const args = createControllerArgs(base, OPENCODE_RUNTIME_DESCRIPTOR, selectedSession);
    args.runtimeDefinitions = [OPENCODE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR];
    args.repoSettings = {
      worktreeBasePath: "",
      branchPrefix: "codex/",
      defaultTargetBranch: { remote: "origin", branch: "main" },
      postCompleteHooks: [],
      actions: { items: [], defaultActionId: null },
      worktreeCopyPaths: [],
      agentDefaults: { spec: null, planner: null, build: null, qa: null },
      defaultModel: {
        runtimeKind: "opencode",
        providerId: "openai",
        modelId: "default-model",
        variant: "",
        profileId: "",
      },
    };
    args.selection = {
      ...args.selection,
      routeSessionResolution: { kind: "none" },
      selectedSessionFromRoute: null,
      resolvedRouteSession: null,
      sessionsForTask: [],
      view: { ...args.selection.view, sessionsForTask: [] },
    };
    const loadRepoRuntimeCatalog = mock(async () =>
      createRuntimeCatalogFixture({
        models: {
          runtime: CODEX_RUNTIME_DESCRIPTOR,
          models: [
            {
              id: "openai/chosen-model",
              providerId: "openai",
              providerName: "OpenAI",
              modelId: "chosen-model",
              modelName: "Chosen model",
              variants: [],
            },
          ],
          defaultModelsByProvider: { openai: "chosen-model" },
        },
      }),
    );
    const connection = createTestClientConnection({
      client: { workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture() },
      scheduleTask: () => () => {},
    });
    let current!: ReturnType<typeof useAgentStudioOrchestrationController>;
    const Composer = () => {
      current = useAgentStudioOrchestrationController(args);
      return createElement(
        AgentChatSettingsProvider,
        { value: current.agentChatModel.chatSettings },
        createElement(AgentChatComposer, { model: current.agentChatModel.composer }),
      );
    };
    const view = render(
      createElement(
        TaskChatProviders,
        {
          runtime: OPENCODE_RUNTIME_DESCRIPTOR,
          runtimeDefinitions: args.runtimeDefinitions,
          runtimeStatus: createHostRuntimeStatusContextValue({
            statusByKind: {
              opencode: createHostRuntimeStatusFixture({ kind: "opencode", state: "disabled" }),
              codex: createHostRuntimeStatusFixture({ kind: "codex", state: "ready" }),
            },
          }),
          loadRepoRuntimeCatalog,
          connection,
        },
        createElement(Composer),
      ),
    );
    try {
      expect(view.getByRole("button", { name: /^Select model/ }).hasAttribute("disabled")).toBe(
        false,
      );
      await act(async () => current.agentChatModel.composer.modelPicker.onOpenChange(true));
      await waitFor(() =>
        expect(
          current.agentChatModel.composer.modelPicker.runtimes.find(
            (runtime) => runtime.descriptor.kind === "codex",
          )?.resource.status,
        ).toBe("ready"),
      );
      await act(async () =>
        current.agentChatModel.composer.modelPicker.onValueChange({
          runtimeKind: "codex",
          providerId: "openai",
          modelId: "chosen-model",
        }),
      );
      await waitFor(() => expect(current.agentChatModel.composer.isInteractionEnabled).toBe(true));
      expect(current.agentChatModel.thread.transcript).toEqual(
        expect.objectContaining({ kind: "empty", notice: null }),
      );
      expect(
        view.getByRole("combobox", { name: "Message composer" }).getAttribute("contenteditable"),
      ).toBe("true");
      expect(current.agentChatModel.composer.selectedModelSelection).toEqual({
        runtimeKind: "codex",
        providerId: "openai",
        modelId: "chosen-model",
      });
      expect(loadRepoRuntimeCatalog).toHaveBeenCalledWith({
        repoPath: "/repo",
        runtimeKind: "codex",
        workingDirectory: "/repo",
      });
    } finally {
      view.unmount();
      connection.queryClient.clear();
    }
  });
});

describe("task workflow artifact loading", () => {
  test.each([
    { existing: "all workflows", hasPlanAndQa: true },
    { existing: "only the spec", hasPlanAndQa: false },
  ])(
    "loads $existing before session preparation and keeps reads active when the transcript is inactive",
    async ({ hasPlanAndQa }) => {
      const base = createBaseArgs();
      const task = createTaskCardFixture({
        id: "task-1",
        artifactSummary: {
          spec: { present: true },
          plan: { present: hasPlanAndQa },
          qaReport: hasPlanAndQa ? { present: true, verdict: "approved" } : { present: false },
        },
      });
      base.selectedSession.selectedTask = task;
      const pendingSession = {
        ...base.selectedSession.selectedSession,
        preparation: { ready: false, error: null },
        loadedSession: null,
        transcriptState: createSelectedSessionTranscriptStateFixture({
          kind: "session_loading",
          reason: "preparing",
        }),
      };
      const args = createControllerArgs(base, OPENCODE_RUNTIME_DESCRIPTOR, pendingSession);
      const sections = hasPlanAndQa ? (["spec", "plan", "qaReport"] as const) : (["spec"] as const);
      const expectedSections = [...sections].sort();
      const releaseReads = Promise.withResolvers<void>();
      let revision = 1;
      const read = mock(async (_repoPath: string, _taskId: string, section: string) => {
        await releaseReads.promise;
        return {
          markdown: `${section} V${revision}`,
          updatedAt: `2026-10-22T1${revision}:00:00Z`,
        };
      });
      const connection = createTestClientConnection({
        client: {
          workflowArtifactGet: read,
          workspaceGetSettingsSnapshot: async () => createSettingsSnapshotFixture(),
        },
        scheduleTask: () => () => {},
      });
      const view = renderHook(useAgentStudioOrchestrationController, {
        initialProps: args,
        wrapper: ({ children }: PropsWithChildren) =>
          createElement(
            TaskChatProviders,
            { runtime: OPENCODE_RUNTIME_DESCRIPTOR, connection },
            children,
          ),
      });
      try {
        await waitFor(
          () =>
            expect(read.mock.calls.map(([, , section]) => section).sort()).toEqual(
              expectedSections,
            ),
          { timeout: 250 },
        );
        await act(async () => releaseReads.resolve());
        view.rerender({
          ...args,
          selection: {
            ...args.selection,
            view: {
              ...args.selection.view,
              selectedSession: {
                ...pendingSession,
                transcriptState: { kind: "empty", reason: "inactive" },
              },
            },
          },
        });
        revision = 2;
        await act(async () => {
          await connection.queryClient.invalidateQueries({ queryKey: documentQueryKeys.all });
        });
        expect(read.mock.calls.map(([, , section]) => section).sort()).toEqual(
          [...expectedSections, ...expectedSections].sort(),
        );
        for (const section of sections)
          expect(read).toHaveBeenCalledWith("/repo", "task-1", section);
      } finally {
        releaseReads.resolve();
        view.unmount();
        connection.queryClient.clear();
      }
    },
  );
});

function TaskChatProviders({
  runtime,
  runtimeDefinitions = [runtime],
  runtimeStatus,
  loadRepoRuntimeCatalog,
  connection,
  children,
}: PropsWithChildren<{
  runtime: RuntimeDescriptor;
  runtimeDefinitions?: RuntimeDescriptor[];
  runtimeStatus?: HostRuntimeStatusContextValue;
  loadRepoRuntimeCatalog?: RuntimeDefinitionsContextValue["loadRepoRuntimeCatalog"];
  connection?: ClientConnection;
}>) {
  return createElement(
    QueryProvider,
    connection ? { connection } : null,
    createElement(
      WorkspaceStateContext.Provider,
      { value: createWorkspaceStateFixture() },
      createElement(
        RuntimeDefinitionsContext.Provider,
        {
          value: {
            runtimeDefinitions,
            availableRuntimeDefinitions: runtimeDefinitions,
            agentRuntimes: DEFAULT_AGENT_RUNTIMES,
            isLoadingRuntimeDefinitions: false,
            runtimeDefinitionsError: null,
            isLoadingRuntimeSettings: false,
            runtimeSettingsError: null,
            hasRuntimeSettingsSnapshot: true,
            refreshRuntimeSettings: async () => {},
            refreshRuntimeDefinitions: async () => runtimeDefinitions,
            loadRepoRuntimeCatalog:
              loadRepoRuntimeCatalog ??
              (async () => {
                throw new Error("Unexpected catalog load");
              }),
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
                runtimeStatus ? { runtimeStatus } : null,
                createElement(MemoryRouter, null, children),
              ),
            ),
          ),
        ),
      ),
    ),
  );
}
