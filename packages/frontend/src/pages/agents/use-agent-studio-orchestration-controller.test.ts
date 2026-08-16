import { describe, expect, test } from "bun:test";
import { OPENCODE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
import { agentStudioChatDraftScopeKey } from "./agent-studio-chat-draft";
import {
  createAgentSessionFixture,
  createSelectedSessionTranscriptStateFixture,
  createTaskCardFixture,
} from "./agent-studio-test-utils";
import { ROLE_OPTIONS } from "./agents-page-constants";
import { buildRoleLabelByRole } from "./agents-page-view-model";
import { buildAgentStudioSelectedSessionContext } from "./selected-session/selected-session-context";
import { buildAgentStudioPageModelsArgs } from "./use-agent-studio-orchestration-controller";

type BuildArgs = Parameters<typeof buildAgentStudioPageModelsArgs>[0];

const onSelectTab = () => {};
const onCreateTab = () => {};
const onCloseTab = () => {};
const onReorderTab = () => {};
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
    isSending: false,
    isSessionWorking: false,
    isWaitingInput: false,
    busySendBlockedReason: null,
    canUseKickoffPrompt: false,
    kickoffLabel: "Kickoff",
    canStopSession: false,
    startLaunchKickoff: async () => {},
    onSend: async () => true,
    onSubmitQuestionAnswers: async () => {},
    isSubmittingQuestionByRequestId: {},
    isSubmittingApprovalByRequestId: {},
    approvalReplyErrorByRequestId: {},
    onReplyApproval: async () => {},
    stopAgentSession: async () => {},
    loadAgentSessionHistory: async () => null,
  };

  return {
    view: {
      taskId: "task-1",
    },
    selectedSession: buildAgentStudioSelectedSessionContext({
      taskId: "task-1",
      role: "planner",
      selectedTask: task,
      sessionsForTask: [sessionSummary],
      allSessionSummaries: [sessionSummary],
      selectedSession: {
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
      hasActiveGitConflict: false,
      documents: {
        specDoc: createTaskDocument(),
        planDoc: createTaskDocument(),
        qaDoc: createTaskDocument(),
      },
      sessionActions,
      roleLabelByRole: buildRoleLabelByRole(ROLE_OPTIONS),
    }),
    tabs: {
      activeTaskTabId: "task-1",
      taskTabs: [],
      availableTabTasks: [task],
      isLoadingTasks: false,
      handleSelectTab: onSelectTab,
      handleCreateTab: onCreateTab,
      handleCloseTab: onCloseTab,
      handleReorderTab: onReorderTab,
    },
    sessionActions,
    modelSelection: {
      selectedModelSelection: null,
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
      agentAccentColorsByProfileId: {},
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

    expect(mapped.activeTabValue).toBe("task-1");
    expect(mapped.selectedSession.role).toBe("planner");
    expect(mapped.selectedSession.selectedSession.transcriptState).toEqual({
      kind: "visible",
    });
    expect(mapped.taskTabs.onSelectTab).toBe(onSelectTab);
    expect(mapped.taskTabs.onCreateTab).toBe(onCreateTab);
    expect(mapped.taskTabs.onCloseTab).toBe(onCloseTab);
    expect(mapped.taskTabs.onReorderTab).toBe(onReorderTab);
    expect(mapped.selectedSession.documents.activeDocument?.document.markdown).toBe("# doc");
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

  test("derives activeTabValue from tab id, task id, then empty sentinel", () => {
    const baseArgs = createBaseArgs();
    const withActiveTab = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      tabs: {
        ...baseArgs.tabs,
        activeTaskTabId: "task-tab-2",
      },
    });
    const withTaskFallback = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      tabs: {
        ...baseArgs.tabs,
        activeTaskTabId: "",
      },
    });
    const withEmptyFallback = buildAgentStudioPageModelsArgs({
      ...baseArgs,
      selectedSession: {
        ...baseArgs.selectedSession,
        taskId: "",
      },
      view: {
        ...baseArgs.view,
        taskId: "",
      },
      tabs: {
        ...baseArgs.tabs,
        activeTaskTabId: "",
      },
    });

    expect(withActiveTab.activeTabValue).toBe("task-tab-2");
    expect(withTaskFallback.activeTabValue).toBe("task-1");
    expect(withEmptyFallback.activeTabValue).toBe("__agent_studio_empty__");
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
