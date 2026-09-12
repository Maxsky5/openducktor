import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { createElement } from "react";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import type { AgentChatMessage } from "@/types/agent-orchestrator";
import { MessageBody } from "./agent-chat-message-card-content";

enableReactActEnvironment();

const createAssistantMessage = (content: string): AgentChatMessage => ({
  id: "assistant-streaming-markdown",
  role: "assistant",
  content,
  timestamp: "2026-08-31T09:37:00.000Z",
  meta: {
    kind: "assistant",
    agentRole: "build",
    isFinal: false,
  },
});

const createMessageBody = (content: string) =>
  createElement(MessageBody, {
    message: createAssistantMessage(content),
    modelCatalog: null,
    parentSession: null,
    assistantAccentColor: undefined,
    isStreamingAssistantMessage: true,
    timeLabel: "",
    systemPromptBody: "",
    sessionWorkingDirectory: null,
    toolCallPresentation: null,
  });

const createReasoningMessageBody = (content: string) =>
  createElement(MessageBody, {
    message: {
      ...createAssistantMessage(content),
      role: "thinking",
      meta: {
        kind: "reasoning",
        partId: "reasoning-streaming-markdown",
        completed: false,
      },
    },
    modelCatalog: null,
    parentSession: null,
    assistantAccentColor: undefined,
    isStreamingAssistantMessage: false,
    timeLabel: "",
    systemPromptBody: "",
    sessionWorkingDirectory: null,
    toolCallPresentation: null,
  });

describe("MessageBody streamed markdown", () => {
  test("renders the computer use card without a generic tool presentation", () => {
    const message: AgentChatMessage = {
      id: "cua-tool",
      role: "tool",
      content: "Tool cua_repl.js completed",
      timestamp: "2026-09-11T12:00:00.000Z",
      meta: {
        kind: "tool",
        partId: "cua-part",
        callId: "cua-call",
        tool: "cua_repl.js",
        toolType: "computer_use",
        status: "completed",
        computerUse: { action: "Inspect the editor", code: "await tab.click()" },
        output: "clicked",
      },
    };
    const rendered = render(
      createElement(MessageBody, {
        message,
        modelCatalog: null,
        parentSession: null,
        assistantAccentColor: undefined,
        isStreamingAssistantMessage: false,
        timeLabel: "",
        systemPromptBody: "",
        sessionWorkingDirectory: null,
        toolCallPresentation: null,
      }),
    );

    try {
      expect(rendered.getByText("Computer Use")).toBeDefined();
      expect(rendered.getByText("Inspect the editor")).toBeDefined();
    } finally {
      rendered.unmount();
    }
  });

  test("renders the current streamed markdown without delaying whitespace or syntax", () => {
    const rendered = render(createMessageBody("Streamed"));

    try {
      rendered.rerender(createMessageBody("Streamed **markdown** text with spaces"));

      expect(rendered.container.textContent).toContain("Streamed markdown text with spaces");
      expect(rendered.container.querySelector("strong")?.textContent).toBe("markdown");
    } finally {
      rendered.unmount();
    }
  });

  test("renders the current reasoning markdown without delaying whitespace or syntax", () => {
    const rendered = render(createReasoningMessageBody("Reasoning"));

    try {
      rendered.rerender(createReasoningMessageBody("Reasoning **markdown** text with spaces"));

      expect(rendered.container.textContent).toContain("Reasoning markdown text with spaces");
      expect(rendered.container.querySelector("strong")?.textContent).toBe("markdown");
    } finally {
      rendered.unmount();
    }
  });
});
