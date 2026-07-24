import { describe, expect, test } from "bun:test";
import { agentChatDraftScopeKey } from "@/components/features/agents/agent-chat/agent-chat-draft-scope";
import type { TaskExecutionSelectedFile } from "@/components/features/agents/task-execution-file-explorer-model";
import { agentSessionIdentityKey, toAgentSessionIdentity } from "@/lib/agent-session-identity";
import { toAgentSessionSummary } from "@/state/agent-sessions-store";
import { createChatSettingsFixture } from "@/test-utils/shared-test-fixtures";
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
  clearTaskExecutionFilePreviewState,
  createTaskExecutionFilePreviewState,
  selectTaskExecutionFilePreviewState,
} from "./use-agent-studio-orchestration-controller";

type BuildArgs = Parameters<typeof buildAgentStudioPageModelsArgs>[0];

const taskDocument = {
  markdown: "# doc",
  updatedAt: "2026-02-22T10:00:00.000Z",
  isLoading: false,
  error: null,
  loaded: true,
};

const task = createTaskCardFixture({ id: "task-1", title: "Task 1" });
const session = createAgentSessionFixture({
  runtimeKind: "opencode",
  externalSessionId: "session-1",
  taskId: "task-1",
  role: "planner",
});
const sessionSummary = toAgentSessionSummary(session);
const onSelectTab = () => {};
const onCreateTab = () => {};
const onCloseTab = () => {};
const onReorderTab = () => {};
const handleSelectAgentProfile = () => {};
const handleSelectModel = () => {};
const handleSelectVariant = () => {};
const baseRuntimeReadiness = {
  state: "ready" as const,
  message: null,
  isLoadingChecks: false,
  refreshChecks: async () => {},
};
const baseSessionActions = {
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
};
const baseDocuments = {
  specDoc: taskDocument,
  planDoc: taskDocument,
  qaDoc: taskDocument,
};
const baseActiveSessionRuntimeData = {
  modelCatalog: null,
  todos: [],
  isLoadingModelCatalog: false,
  error: null,
};
const baseChatSettings = createChatSettingsFixture({
  showThinkingMessages: true,
  expandFileDiffsByDefault: false,
  diffStyle: "unified",
  diffIndicators: "none",
  diffHeight: "scroll",
  lineOverflow: "scroll",
  hunkSeparators: "simple",
});

const baseArgs: BuildArgs = {
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
      runtimeData: baseActiveSessionRuntimeData,
      runtimeReadiness: baseRuntimeReadiness,
      transcriptState: createSelectedSessionTranscriptStateFixture(),
    },
    hasActiveGitConflict: false,
    documents: baseDocuments,
    sessionActions: baseSessionActions,
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
  sessionActions: baseSessionActions,
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
    modelOptions: [],
    modelGroups: [],
    variantOptions: [],
    handleSelectAgentProfile,
    handleSelectModel,
    handleSelectVariant,
    agentAccentColorsByProfileId: {},
    selectedSessionContextUsage: null,
  },
  chatSettings: baseChatSettings,
  composer: {
    workspaceId: "workspace-repo",
    draftScope: {
      taskId: "task-1",
      role: "planner",
      session: toAgentSessionIdentity(session),
    },
  },
};

const firstPreviewFile: TaskExecutionSelectedFile = {
  rootPath: "/repo",
  relativePath: "src/first.ts",
};
const secondPreviewFile: TaskExecutionSelectedFile = {
  rootPath: "/repo",
  relativePath: "src/second.ts",
};

describe("task execution file preview state", () => {
  test("starts a new preview session when selecting from a closed preview", () => {
    const initialState = createTaskExecutionFilePreviewState();
    const openedState = selectTaskExecutionFilePreviewState(initialState, firstPreviewFile);
    const closedState = clearTaskExecutionFilePreviewState(openedState);
    const reopenedState = selectTaskExecutionFilePreviewState(closedState, secondPreviewFile);

    expect(openedState).toEqual({
      selectedFile: firstPreviewFile,
      previewSessionKey: 1,
      preservePreviousSnapshot: false,
    });
    expect(closedState).toEqual({
      selectedFile: null,
      previewSessionKey: 2,
      preservePreviousSnapshot: false,
    });
    expect(reopenedState).toEqual({
      selectedFile: secondPreviewFile,
      previewSessionKey: 3,
      preservePreviousSnapshot: false,
    });
  });

  test("keeps the preview session stable while switching between open files", () => {
    const openedState = selectTaskExecutionFilePreviewState(
      createTaskExecutionFilePreviewState(),
      firstPreviewFile,
    );
    const switchedState = selectTaskExecutionFilePreviewState(openedState, secondPreviewFile);

    expect(switchedState.selectedFile).toBe(secondPreviewFile);
    expect(switchedState.previewSessionKey).toBe(openedState.previewSessionKey);
    expect(switchedState.preservePreviousSnapshot).toBe(true);
  });

  test("does not churn preview sessions when already closed", () => {
    const initialState = createTaskExecutionFilePreviewState();
    const closedState = clearTaskExecutionFilePreviewState(initialState);

    expect(closedState).toBe(initialState);
  });
});

describe("buildAgentStudioPageModelsArgs", () => {
  test("maps grouped orchestration context into page-model contracts", () => {
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
    expect(mapped.modelSelection.onSelectModel).toBe(handleSelectModel);
    expect(mapped.modelSelection.onSelectVariant).toBe(handleSelectVariant);
    expect(mapped.chatSettings).toEqual(baseChatSettings);
    expect(mapped.composer.draftScope).toEqual({
      taskId: "task-1",
      role: "planner",
      session: toAgentSessionIdentity(session),
    });
    expect(agentChatDraftScopeKey(mapped.composer.draftScope)).toBe(
      `task-1:planner:${agentSessionIdentityKey(toAgentSessionIdentity(session))}`,
    );
  });

  test("derives activeTabValue from tab id, task id, then empty sentinel", () => {
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
