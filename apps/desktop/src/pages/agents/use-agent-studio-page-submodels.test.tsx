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
  threadSession: null,
  isSessionWorking: false,
  showThinkingMessages,
  isContextSwitching: false,
  isSessionHistoryLoading: false,
  taskId: "task-1",
  activeSessionAgentColors: {},
  agentStudioReadinessState: "ready",
  agentStudioReady: true,
  agentStudioBlockedReason: "",
  isLoadingChecks: false,
  refreshChecks: async () => {},
  canKickoffNewSession: true,
  selectedRoleAvailable: true,
  kickoffLabel: "Start",
  startScenarioKickoff: async () => {},
  isStarting: false,
  isSending: false,
  isSubmittingQuestionByRequestId: {},
  onSubmitQuestionAnswers: async () => {},
  isSubmittingPermissionByRequestId: {},
  permissionReplyErrorByRequestId: {},
  onReplyPermission: async () => {},
  todoPanelCollapsed: false,
  onToggleTodoPanel: () => {},
  messagesContainerRef: createRef<HTMLDivElement>(),
  scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
  syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
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

  test("forwards isSessionWorking into the thread model", async () => {
    const harness = createHookHarness({
      ...createHookArgs(false),
      isSessionWorking: true,
    });

    await harness.mount();
    expect(harness.getLatest().isSessionWorking).toBe(true);

    await harness.unmount();
  });

  test("forwards readiness state into the thread model", async () => {
    const harness = createHookHarness({
      ...createHookArgs(false),
      agentStudioReadinessState: "blocked",
      agentStudioReady: false,
      agentStudioBlockedReason: "Runtime unavailable",
    });

    await harness.mount();
    expect(harness.getLatest().readinessState).toBe("blocked");
    expect(harness.getLatest().blockedReason).toBe("Runtime unavailable");

    await harness.unmount();
  });
});
