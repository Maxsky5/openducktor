import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import TestRenderer, { act } from "react-test-renderer";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import { AgentSessionQuestionCard } from "./agent-session-question-card";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const TEST_RENDERER_DEPRECATION_WARNING = "react-test-renderer is deprecated";
const originalConsoleError = console.error;

type CardProps = React.ComponentProps<typeof AgentSessionQuestionCard>;

const buildRequest = (overrides: Partial<AgentQuestionRequest> = {}): AgentQuestionRequest => ({
  requestId: "request-1",
  questions: [
    {
      header: "Scope",
      question: "Which area should we prioritize?",
      options: [
        { label: "Frontend", description: "UI and interaction work" },
        { label: "Backend", description: "Services and persistence" },
      ],
      multiple: false,
    },
  ],
  ...overrides,
});

const flush = async (): Promise<void> => {
  await Promise.resolve();
  await Promise.resolve();
};

const nodeText = (node: TestRenderer.ReactTestInstance): string => {
  return node.children
    .map((child) => {
      if (typeof child === "string") {
        return child;
      }
      return nodeText(child);
    })
    .join("");
};

const createCardHarness = (props: CardProps) => {
  let renderer: TestRenderer.ReactTestRenderer | null = null;

  const mount = async (): Promise<void> => {
    await act(async () => {
      renderer = TestRenderer.create(createElement(AgentSessionQuestionCard, props));
      await flush();
    });
  };

  const unmount = async (): Promise<void> => {
    await act(async () => {
      renderer?.unmount();
      await flush();
    });
  };

  const clickButtonByText = async (label: string, index = 0): Promise<void> => {
    if (!renderer) {
      throw new Error("Renderer not mounted");
    }
    const button = renderer.root.findAll(
      (node) =>
        node.type === "button" &&
        typeof node.props.onClick === "function" &&
        nodeText(node).includes(label),
    )[index];
    if (!button) {
      throw new Error(`No button found for label '${label}' at index ${index}`);
    }
    await act(async () => {
      button.props.onClick();
      await flush();
    });
  };

  const getButtonDisabled = (label: string): boolean => {
    if (!renderer) {
      throw new Error("Renderer not mounted");
    }
    const button = renderer.root.find(
      (node) =>
        node.type === "button" &&
        typeof node.props.onClick === "function" &&
        nodeText(node).includes(label),
    );
    return Boolean(button.props.disabled);
  };

  const asText = (): string => {
    if (!renderer) {
      throw new Error("Renderer not mounted");
    }
    return JSON.stringify(renderer.toJSON());
  };

  return { mount, unmount, clickButtonByText, getButtonDisabled, asText };
};

describe("AgentSessionQuestionCard", () => {
  beforeEach(() => {
    console.error = (...args: unknown[]): void => {
      if (typeof args[0] === "string" && args[0].includes(TEST_RENDERER_DEPRECATION_WARNING)) {
        return;
      }
      originalConsoleError(...args);
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("navigates from summary to a selected question tab", async () => {
    const harness = createCardHarness({
      request: buildRequest({
        questions: [
          {
            header: "Architecture",
            question: "What architecture should we follow?",
            options: [{ label: "Hexagonal", description: "Ports and adapters" }],
            multiple: false,
          },
          {
            header: "Validation",
            question: "How should we validate this change?",
            options: [{ label: "Integration tests", description: "Exercise full card flow" }],
            multiple: false,
          },
        ],
      }),
      onSubmit: async () => {},
    });
    await harness.mount();

    await harness.clickButtonByText("Summary");
    expect(harness.asText()).toContain("No answer yet");

    await harness.clickButtonByText("Validation", 1);
    expect(harness.asText()).toContain("How should we validate this change?");
    expect(harness.asText()).not.toContain("No answer yet");

    await harness.unmount();
  });

  test("enables submit after completion and sends normalized answers", async () => {
    const onSubmit = mock(async () => {});
    const harness = createCardHarness({
      request: buildRequest(),
      onSubmit,
    });
    await harness.mount();

    expect(harness.getButtonDisabled("Confirm Answers")).toBe(true);

    await harness.clickButtonByText("Frontend");
    expect(harness.getButtonDisabled("Confirm Answers")).toBe(false);

    await harness.clickButtonByText("Confirm Answers");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("request-1", [["Frontend"]]);

    await harness.unmount();
  });

  test("reset clears draft answers and disables submit again", async () => {
    const harness = createCardHarness({
      request: buildRequest(),
      onSubmit: async () => {},
    });
    await harness.mount();

    await harness.clickButtonByText("Backend");
    expect(harness.getButtonDisabled("Confirm Answers")).toBe(false);
    expect(harness.asText()).toContain("All questions answered.");

    await harness.clickButtonByText("Reset");
    expect(harness.getButtonDisabled("Confirm Answers")).toBe(true);
    expect(harness.asText()).toContain("Answer all questions to confirm.");

    await harness.unmount();
  });

  test("shows submit errors and clears them after user edits", async () => {
    const harness = createCardHarness({
      request: buildRequest(),
      onSubmit: async () => {
        throw new Error("Submission exploded");
      },
    });
    await harness.mount();

    await harness.clickButtonByText("Frontend");
    await harness.clickButtonByText("Confirm Answers");
    expect(harness.asText()).toContain("Submission exploded");

    await harness.clickButtonByText("Frontend");
    expect(harness.asText()).not.toContain("Submission exploded");

    await harness.unmount();
  });
});
