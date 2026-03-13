import { describe, expect, test } from "bun:test";
import { createRef } from "react";
import {
  createHookHarness as createSharedHookHarness,
  enableReactActEnvironment,
} from "./agent-studio-test-utils";
import { useAgentStudioThreadModel } from "./use-agent-studio-page-submodels";

enableReactActEnvironment();

type HookArgs = Parameters<typeof useAgentStudioThreadModel>[0];

const createHookArgs = (showThinkingMessages = false): HookArgs => ({
  session: {
    threadSession: null,
    showThinkingMessages,
    isContextSwitching: false,
    taskId: "task-1",
    activeSessionAgentColors: {},
  },
  readiness: {
    agentStudioReady: true,
    agentStudioBlockedReason: "",
    isLoadingChecks: false,
    refreshChecks: async () => {},
  },
  kickoff: {
    canKickoffNewSession: true,
    selectedRoleAvailable: true,
    kickoffLabel: "Start",
    startScenarioKickoff: async () => {},
    isStarting: false,
    isSending: false,
  },
  questions: {
    isSubmittingQuestionByRequestId: {},
    onSubmitQuestionAnswers: async () => {},
  },
  permissions: {
    isSubmittingPermissionByRequestId: {},
    permissionReplyErrorByRequestId: {},
    onReplyPermission: async () => {},
  },
  todoPanel: {
    todoPanelCollapsed: false,
    onToggleTodoPanel: () => {},
    todoPanelBottomOffset: 0,
  },
  scroll: {
    isPinnedToBottom: true,
    messagesContainerRef: createRef<HTMLDivElement>(),
    onMessagesPointerDown: () => {},
    onMessagesScroll: () => {},
    onMessagesTouchMove: () => {},
    onMessagesWheel: () => {},
  },
});

const createHookHarness = (initialProps: HookArgs) =>
  createSharedHookHarness(useAgentStudioThreadModel, initialProps);

describe("useAgentStudioThreadModel", () => {
  test("forwards showThinkingMessages into the thread model", async () => {
    const harness = createHookHarness(createHookArgs(true));

    await harness.mount();
    expect(harness.getLatest().showThinkingMessages).toBe(true);

    await harness.update(createHookArgs(false));
    expect(harness.getLatest().showThinkingMessages).toBe(false);

    await harness.unmount();
  });
});
