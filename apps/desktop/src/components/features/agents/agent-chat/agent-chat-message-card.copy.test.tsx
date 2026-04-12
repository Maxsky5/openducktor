import { beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { buildCopyPreview } from "@/lib/copy-preview";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { withMockedToast } from "@/test-utils/mock-toast";
import { AgentChatMessageCard } from "./agent-chat-message-card";

enableReactActEnvironment();

const writeClipboardMock = mock(async (_value: string) => {});

describe("AgentChatMessageCard assistant copy", () => {
  beforeEach(() => {
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
    await withMockedToast(async ({ toastSuccessMock }) => {
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
            },
          },
          sessionRole: "planner",
          sessionSelectedModel: null,
          sessionAgentColors: {},
        }),
      );

      try {
        fireEvent.click(rendered.getByTestId("copy-assistant-message-content"));

        await waitFor(() => {
          expect(writeClipboardMock).toHaveBeenCalledWith(markdown);
          expect(toastSuccessMock).toHaveBeenCalledWith("Copied!", {
            description: buildCopyPreview(markdown),
          });
        });
      } finally {
        rendered.unmount();
      }
    });
  });

  test("copies completed intermediate assistant messages when they are not actively streaming", async () => {
    await withMockedToast(async ({ toastSuccessMock }) => {
      const markdown = "# Intermediate update\n\nStill working through the task.";
      const rendered = render(
        createElement(AgentChatMessageCard, {
          message: {
            id: "assistant-copy-intermediate",
            role: "assistant",
            content: markdown,
            timestamp: "2026-02-22T10:24:47.000Z",
            meta: {
              kind: "assistant",
              agentRole: "planner",
              isFinal: false,
            },
          },
          isStreamingAssistantMessage: false,
          sessionRole: "planner",
          sessionSelectedModel: null,
          sessionAgentColors: {},
        }),
      );

      try {
        fireEvent.click(rendered.getByTestId("copy-assistant-message-content"));

        await waitFor(() => {
          expect(writeClipboardMock).toHaveBeenCalledWith(markdown);
          expect(toastSuccessMock).toHaveBeenCalledWith("Copied!", {
            description: buildCopyPreview(markdown),
          });
        });
      } finally {
        rendered.unmount();
      }
    });
  });

  test("shows the copied-state icon after a successful copy", async () => {
    await withMockedToast(async () => {
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
        }),
      );

      try {
        const button = rendered.getByTestId("copy-assistant-message-content");
        expect(button.querySelector(".lucide-copy")).not.toBeNull();

        fireEvent.click(button);

        await waitFor(() => {
          expect(button.querySelector(".lucide-check")).not.toBeNull();
        });
      } finally {
        rendered.unmount();
      }
    });
  });

  test("shows the shared clipboard error toast when copying fails", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
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

      try {
        fireEvent.click(rendered.getByTestId("copy-assistant-message-content"));

        await waitFor(() => {
          expect(toastErrorMock).toHaveBeenCalledWith(
            "Permission denied: clipboard access not allowed",
          );
        });
      } finally {
        rendered.unmount();
      }
    });
  });
});
