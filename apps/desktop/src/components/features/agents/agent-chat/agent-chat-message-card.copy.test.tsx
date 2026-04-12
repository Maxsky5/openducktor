import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

enableReactActEnvironment();

const toastSuccessMock = mock(() => {});
const toastErrorMock = mock(() => {});
const writeClipboardMock = mock(async (_value: string) => {});

type AgentChatMessageCardComponent =
  typeof import("./agent-chat-message-card").AgentChatMessageCard;
let AgentChatMessageCard: AgentChatMessageCardComponent;

describe("AgentChatMessageCard assistant copy", () => {
  beforeAll(async () => {
    mock.module("sonner", () => ({
      toast: {
        success: toastSuccessMock,
        error: toastErrorMock,
        loading: () => "",
        dismiss: () => {},
      },
    }));

    ({ AgentChatMessageCard } = await import("./agent-chat-message-card"));
  });

  afterAll(async () => {
    await restoreMockedModules([["sonner", () => import("sonner")]]);
  });

  beforeEach(() => {
    toastSuccessMock.mockClear();
    toastErrorMock.mockClear();
    writeClipboardMock.mockClear();
    writeClipboardMock.mockImplementation(async () => {});

    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: writeClipboardMock,
      },
    });
  });

  test("copies the raw assistant markdown and shows the shared success preview", async () => {
    const markdown = "12345678901234567890123456789012345678901234567890tail";
    const rendered = render(
      createElement(AgentChatMessageCard, {
        message: {
          id: "assistant-copy-success",
          role: "assistant",
          content: markdown,
          timestamp: "2026-02-22T10:24:45.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            isFinal: true,
          },
        },
        sessionRole: "planner",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    fireEvent.click(rendered.getByTestId("copy-assistant-message-content"));

    await waitFor(() => {
      expect(writeClipboardMock).toHaveBeenCalledWith(markdown);
      expect(toastSuccessMock).toHaveBeenCalledWith("Copied!", {
        description: `${markdown.slice(0, 50)}...`,
      });
    });
    rendered.unmount();
  });

  test("shows the copied-state icon and resets it after the shared delay", async () => {
    const rendered = render(
      createElement(AgentChatMessageCard, {
        message: {
          id: "assistant-copy-reset",
          role: "assistant",
          content: "# Summary",
          timestamp: "2026-02-22T10:24:50.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            isFinal: true,
          },
        },
        sessionRole: "planner",
        sessionSelectedModel: null,
        sessionAgentColors: {},
        copyResetDelayMs: 5,
      }),
    );

    try {
      const button = rendered.getByTestId("copy-assistant-message-content");
      expect(button.querySelector(".lucide-copy")).not.toBeNull();

      fireEvent.click(button);

      await waitFor(() => {
        expect(button.querySelector(".lucide-check")).not.toBeNull();
      });

      await waitFor(() => {
        expect(button.querySelector(".lucide-copy")).not.toBeNull();
      });
    } finally {
      rendered.unmount();
    }
  });

  test("shows the shared clipboard error toast when copying fails", async () => {
    const error = new DOMException("blocked by browser", "NotAllowedError");
    writeClipboardMock.mockImplementation(async () => {
      throw error;
    });

    const rendered = render(
      createElement(AgentChatMessageCard, {
        message: {
          id: "assistant-copy-error",
          role: "assistant",
          content: "# Summary\n\nFailure case",
          timestamp: "2026-02-22T10:24:55.000Z",
          meta: {
            kind: "assistant",
            agentRole: "planner",
            isFinal: true,
          },
        },
        sessionRole: "planner",
        sessionSelectedModel: null,
        sessionAgentColors: {},
      }),
    );

    fireEvent.click(rendered.getByTestId("copy-assistant-message-content"));

    await waitFor(() => {
      expect(toastErrorMock).toHaveBeenCalledWith(
        "Permission denied: clipboard access not allowed",
      );
    });
    rendered.unmount();
  });
});
