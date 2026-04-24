import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, createElement } from "react";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import { AgentSessionQuestionCard } from "./agent-session-question-card";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

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

const createCardHarness = (props: CardProps) => {
  let rendered: ReturnType<typeof render> | null = null;

  const mount = async (): Promise<void> => {
    rendered = render(createElement(AgentSessionQuestionCard, props));
  };

  const unmount = async (): Promise<void> => {
    rendered?.unmount();
  };

  const clickButtonByText = async (label: string, index = 0): Promise<void> => {
    const button = screen.getAllByRole("button", { name: new RegExp(label, "i") })[index];
    if (!button) {
      throw new Error(`No button found for label '${label}' at index ${index}`);
    }
    await act(async () => {
      fireEvent.click(button);
    });
  };

  const getButtonDisabled = (label: string): boolean => {
    const button = screen.getByRole("button", { name: new RegExp(label, "i") });
    return button.hasAttribute("disabled");
  };

  const asText = (): string => {
    if (!rendered) {
      throw new Error("Renderer not mounted");
    }
    return rendered.container.textContent ?? "";
  };

  return { mount, unmount, clickButtonByText, getButtonDisabled, asText };
};

describe("AgentSessionQuestionCard", () => {
  beforeEach(() => {
    console.error = (...args: unknown[]): void => {
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
    await waitFor(() => {
      expect(harness.asText()).toContain("Submission exploded");
    });

    await harness.clickButtonByText("Frontend");
    expect(harness.asText()).not.toContain("Submission exploded");

    await harness.unmount();
  });
});
