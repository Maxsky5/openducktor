import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render } from "@testing-library/react";
import { createElement, createRef } from "react";
import { buildMessage, buildSession, TEST_ROLE_OPTIONS } from "./agent-chat-test-fixtures";
import { AgentChatThread } from "./agent-chat-thread";

const buildBaseModel = () => ({
  isSessionWorking: false,
  showThinkingMessages: false,
  isSessionViewLoading: false,
  isSessionHistoryLoading: false,
  isWaitingForRuntimeReadiness: false,
  roleOptions: TEST_ROLE_OPTIONS,
  readinessState: "ready" as const,
  agentStudioReady: true,
  blockedReason: "",
  isLoadingChecks: false,
  onRefreshChecks: () => {},
  taskSelected: true,
  canKickoffNewSession: false,
  kickoffLabel: "Start Spec",
  onKickoff: () => {},
  isStarting: false,
  isSending: false,
  sessionAgentColors: {},
  isSubmittingQuestionByRequestId: {},
  isSubmittingPermissionByRequestId: {},
  permissionReplyErrorByRequestId: {},
  onSubmitQuestionAnswers: async () => {},
  onReplyPermission: async () => {},
  sessionRuntimeDataError: null,
  todoPanelCollapsed: false,
  onToggleTodoPanel: () => {},
  messagesContainerRef: createRef<HTMLDivElement>(),
  scrollToBottomOnSendRef: { current: null } as { current: (() => void) | null },
  syncBottomAfterComposerLayoutRef: { current: null } as { current: (() => void) | null },
});

const buildLongSession = (sessionId: string, count = 80) => {
  const messages = Array.from({ length: count }, (_, index) =>
    buildMessage("user", `Message ${index + 1}`, {
      id: `message-${index + 1}`,
    }),
  );

  return buildSession({
    sessionId,
    messages,
    status: "idle",
    pendingQuestions: [],
    pendingPermissions: [],
  });
};

afterEach(() => {
  const runtimeWindow = globalThis.window as Window & { __TAURI_INTERNALS__?: object };
  delete runtimeWindow.__TAURI_INTERNALS__;
  cleanup();
});

describe("AgentChatThread Tauri runtime", () => {
  test("keeps turn containment enabled in the Tauri runtime when no attachments are present", () => {
    const runtimeWindow = globalThis.window as Window & { __TAURI_INTERNALS__?: object };
    runtimeWindow.__TAURI_INTERNALS__ = {};

    const rendered = render(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildLongSession("session-tauri", 80),
        },
      }),
    );

    expect(rendered.container.querySelector('[style*="content-visibility"]')).not.toBeNull();
    expect(rendered.container.querySelector('[style*="contain-intrinsic-size"]')).not.toBeNull();
  });
});
