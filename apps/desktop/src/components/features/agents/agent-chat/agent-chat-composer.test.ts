import { describe, expect, test } from "bun:test";
import { createElement, createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentChatComposer } from "./agent-chat-composer";
import { buildModelSelection } from "./agent-chat-test-fixtures";

const buildModel = () => ({
  taskId: "task-1",
  agentStudioReady: true,
  isReadOnly: false,
  readOnlyReason: null,
  input: "hello",
  onInputChange: () => {},
  onSend: () => {},
  isSending: false,
  isStarting: false,
  isSessionWorking: false,
  isModelSelectionPending: false,
  selectedModelSelection: buildModelSelection(),
  isSelectionCatalogLoading: false,
  agentOptions: [{ value: "Hephaestus (Deep Agent)", label: "Hephaestus (Deep Agent)" }],
  modelOptions: [{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" }],
  modelGroups: [
    {
      label: "OpenAI",
      options: [{ value: "openai/gpt-5.3-codex", label: "GPT-5.3 Codex" }],
    },
  ],
  variantOptions: [{ value: "high", label: "high" }],
  onSelectAgent: () => {},
  onSelectModel: () => {},
  onSelectVariant: () => {},
  sessionAgentColors: {
    "Hephaestus (Deep Agent)": "#d97706",
  },
  contextUsage: {
    totalTokens: 45_000,
    contextWindow: 200_000,
    outputLimit: 8_000,
  },
  canStopSession: true,
  onStopSession: () => {},
  composerFormRef: createRef<HTMLFormElement>(),
  composerTextareaRef: createRef<HTMLTextAreaElement>(),
  onComposerTextareaInput: () => {},
});

describe("AgentChatComposer", () => {
  test("renders input, selectors, and send action", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: buildModel(),
      }),
    );

    expect(html).toContain("@ for files/agents; / for commands; ! for shell");
    expect(html).toContain("Send message");
    expect(html).toContain("Stop session");
    expect(html).toContain("22.5%");
  });

  test("hides stop and context widgets when not available", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          contextUsage: null,
          canStopSession: false,
        },
      }),
    );

    expect(html).not.toContain("Stop session");
    expect(html).not.toContain("22.5%");
  });

  test("disables send when input is blank", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          input: "   ",
        },
      }),
    );

    expect(html).toContain('aria-label="Send message" disabled');
  });

  test("styles composer shell with agent accent border and padded container", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: buildModel(),
      }),
    );

    expect(html).toContain("px-4 pb-4");
    expect(html).toContain("border-l-4");
    expect(html).toContain("bg-white shadow-md");
    expect(html).toContain("focus-within:shadow-xl");
    expect(html).toContain("border-left-color:#d97706");
  });

  test("renders read-only mode when selected role is unavailable", () => {
    const html = renderToStaticMarkup(
      createElement(AgentChatComposer, {
        model: {
          ...buildModel(),
          isReadOnly: true,
          readOnlyReason: "Planner is unavailable for this task right now.",
        },
      }),
    );

    expect(html).toContain("Planner is unavailable for this task right now.");
    expect(html).toContain('aria-label="Send message" disabled');
  });
});
