import { afterEach, describe, expect, test } from "bun:test";
import { cleanup, render, waitFor } from "@testing-library/react";
import { createElement, createRef } from "react";
import { buildMessage, buildSession } from "./agent-chat-test-fixtures";
import { AgentChatThread } from "./agent-chat-thread";

const buildBaseModel = () => ({
  isSessionWorking: false,
  showThinkingMessages: false,
  isSessionViewLoading: false,
  isSessionHistoryLoading: false,
  isWaitingForRuntimeReadiness: false,
  readinessState: "ready" as const,
  isInteractionEnabled: true,
  blockedReason: "",
  isLoadingChecks: false,
  onRefreshChecks: () => {},
  isStarting: false,
  isSending: false,
  sessionAgentColors: {},
  canSubmitQuestionAnswers: true,
  isSubmittingQuestionByRequestId: {},
  canReplyToPermissions: true,
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

const buildLongSession = (externalSessionId: string, count = 80) => {
  const messages = Array.from({ length: count }, (_, index) =>
    buildMessage(index % 2 === 0 ? "user" : "assistant", `Message ${index + 1}`, {
      id: `message-${index + 1}`,
    }),
  );

  return buildSession({
    externalSessionId,
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
  test("keeps turn containment enabled in the Tauri runtime when no attachments are present", async () => {
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

    await waitFor(() => {
      expect(rendered.container.querySelector('[style*="content-visibility"]')).not.toBeNull();
      expect(rendered.container.querySelector('[style*="contain-intrinsic-size"]')).not.toBeNull();
    });
  });
});
