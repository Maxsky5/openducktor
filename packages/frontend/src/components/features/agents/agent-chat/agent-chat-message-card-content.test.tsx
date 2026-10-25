import { describe, expect, test } from "bun:test";
import { CLAUDE_RUNTIME_DESCRIPTOR, CODEX_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
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
import { createMessageCardElement } from "./agent-chat-message-card-test-harness";
import { resolveAgentChatRuntimePresentation } from "./agent-chat-runtime-presentation";
import { buildMessage } from "./agent-chat-test-fixtures";

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
  test.each([
    {
      name: "Plan entry reminders",
      content: `<system-reminder>
You are in Plan mode. Discuss the plan with the user directly in the conversation. Do not create or update plan files unless the user explicitly asks you to; when they do, write them only in:
/home/user/.opencode/plan

Do not modify any other files or ask a subagent to do so.

You remain in Plan mode until the user switches agents. If the user asks you to implement changes, do not do so. Tell them they need to switch agents.
</system-reminder>`,
    },
    {
      name: "Plan exit reminders",
      content: `<system-reminder>
You are NO LONGER in Plan mode. The previous Plan restrictions no longer apply. Any Plan mode instructions from earlier in this conversation are no longer active.
</system-reminder>`,
    },
    {
      name: "unclassified system text",
      content: "Keep **literal** text.\n\n<runtime-note>\n  Preserve the spaces.\n</runtime-note>",
    },
  ])("keeps $name in a closed system disclosure with the full text", ({ content }) => {
    const rendered = render(createMessageCardElement({ message: buildMessage("system", content) }));

    try {
      const summary = rendered.getByText("Show system message", { selector: "summary" });
      const disclosure = summary.closest("details");
      expect(disclosure?.open).toBe(false);
      expect(disclosure?.querySelector("p")?.textContent).toBe(content);

      fireEvent.click(summary);

      expect(disclosure?.open).toBe(true);
      expect(disclosure?.querySelector("p")?.textContent).toBe(content);
    } finally {
      rendered.unmount();
    }
  });

  test.each([CODEX_RUNTIME_DESCRIPTOR, CLAUDE_RUNTIME_DESCRIPTOR])(
    "keeps $kind system text outside the OpenCode disclosure",
    (runtime) => {
      const content = "<system-reminder>Keep this system text visible.</system-reminder>";
      const rendered = render(
        createMessageCardElement({
          message: buildMessage("system", content),
          sessionIdentity: { runtimeKind: runtime.kind, workingDirectory: "/repo" },
          runtimePresentation: resolveAgentChatRuntimePresentation({
            runtimeDefinitions: [runtime],
            runtimeKind: runtime.kind,
          }),
        }),
      );

      try {
        expect(rendered.container.querySelector("details")).toBeNull();
        expect(rendered.container.querySelector("p")?.textContent).toBe(content);
      } finally {
        rendered.unmount();
      }
    },
  );

  test("keeps user reminder text outside the system disclosure", () => {
    const rendered = render(
      createMessageCardElement({
        message: buildMessage("user", "You are in Plan mode. Keep this user text visible."),
      }),
    );

    try {
      expect(rendered.container.querySelector("details")).toBeNull();
      expect(rendered.container.textContent).toContain(
        "You are in Plan mode. Keep this user text visible.",
      );
    } finally {
      rendered.unmount();
    }
  });

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
