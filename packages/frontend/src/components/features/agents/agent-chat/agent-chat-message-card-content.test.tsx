import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import { formatBrowserAnnotationsMessage } from "@/features/browser-annotations/browser-annotation-message";
import {
  buildAnnotation,
  buildCapture,
} from "@/features/browser-annotations/browser-annotation-test-support";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import type { AgentChatMessage } from "@openducktor/frontend-core/types/agent-orchestrator";
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
    sessionRuntimeKind: null,
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
    sessionRuntimeKind: null,
    parentSession: null,
    assistantAccentColor: undefined,
    isStreamingAssistantMessage: false,
    timeLabel: "",
    systemPromptBody: "",
    sessionWorkingDirectory: null,
    toolCallPresentation: null,
  });

const createUserMessageBody = (text: string) =>
  createElement(MessageBody, {
    message: {
      id: "user-annotations",
      role: "user",
      content: text,
      timestamp: "2026-10-16T21:00:00.000Z",
      meta: { kind: "user", state: "read", parts: [{ kind: "text", text }] },
    },
    modelCatalog: null,
    sessionRuntimeKind: null,
    parentSession: null,
    assistantAccentColor: undefined,
    isStreamingAssistantMessage: false,
    timeLabel: "",
    systemPromptBody: "",
    sessionWorkingDirectory: null,
    toolCallPresentation: null,
  });

describe("MessageBody", () => {
  test("shows the browser annotations of a user message as chips, not as their text", async () => {
    const elements = buildCapture().elements.map((element) => ({ ...element, source: null }));
    const block = formatBrowserAnnotationsMessage(
      [buildAnnotation({ comment: "Make it blue" }), buildAnnotation({ number: 2, elements })],
      "/repo",
    );
    const rendered = render(createUserMessageBody(`Fix these.\n\n${block}`));

    const chips = rendered.getAllByTestId("browser-annotation-message-chip");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      "Make it blue",
      "Make the save button blue.",
    ]);
    expect(chips[0]?.getAttribute("aria-label")).toBe(
      "Browser annotation 1: Make it blue. “Save” button on localhost:5173/settings",
    );
    expect(rendered.container.textContent).toContain("Fix these.");
    expect(rendered.container.textContent).not.toContain("browser_annotations");

    const [first] = chips;
    if (!first) throw new Error("Expected an annotation chip");
    fireEvent.focus(first);
    const tooltip = await rendered.findByRole("tooltip");
    expect(tooltip.textContent).toContain("save-button.tsx:12");
  });

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
        sessionRuntimeKind: null,
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
