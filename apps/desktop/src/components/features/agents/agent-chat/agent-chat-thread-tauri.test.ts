import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildMessage, buildSession, TEST_ROLE_OPTIONS } from "./agent-chat-test-fixtures";

let AgentChatThread: typeof import("./agent-chat-thread").AgentChatThread;

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

beforeAll(async () => {
  mock.module("@/lib/runtime", () => ({
    isTauriRuntime: () => true,
    assertTauriRuntime: () => {},
  }));

  ({ AgentChatThread } = await import("./agent-chat-thread"));
});

afterAll(() => {
  mock.restore();
});

describe("AgentChatThread Tauri runtime", () => {
  test("disables turn containment in the Tauri runtime", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatThread, {
        model: {
          ...buildBaseModel(),
          session: buildLongSession("session-tauri", 80),
        },
      }),
    );

    expect(html).not.toContain("content-visibility:auto");
    expect(html).not.toContain("contain-intrinsic-size:auto 500px");
  });
});
