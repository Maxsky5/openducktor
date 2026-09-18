import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { act, createElement } from "react";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import { AgentSessionQuestionCard } from "./agent-session-question-card";

enableReactActEnvironment();

const originalConsoleError = console.error;

type CardProps = React.ComponentProps<typeof AgentSessionQuestionCard>;

const getRequiredAttribute = (element: Element, attribute: string): string => {
  const value = element.getAttribute(attribute);
  if (value === null) {
    throw new Error(`Expected element to have '${attribute}' attribute`);
  }
  return value;
};

const expectActiveTabPanel = (tab: HTMLElement): void => {
  const panel = screen.getByRole("tabpanel");
  expect(tab.getAttribute("aria-selected")).toBe("true");
  expect(panel.id).toBe(getRequiredAttribute(tab, "aria-controls"));
  expect(panel.getAttribute("aria-labelledby")).toBe(tab.id);
};

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

  const rerender = async (nextProps: CardProps): Promise<void> => {
    if (!rendered) {
      throw new Error("Renderer not mounted");
    }
    await act(async () => {
      rendered?.rerender(createElement(AgentSessionQuestionCard, nextProps));
    });
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

  const clickTabByText = async (label: string): Promise<void> => {
    const tab = screen.getByRole("tab", { name: new RegExp(label, "i") });
    await act(async () => {
      fireEvent.click(tab);
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

  return { mount, rerender, unmount, clickButtonByText, clickTabByText, getButtonDisabled, asText };
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

  test("labels subagent question requests", async () => {
    const harness = createCardHarness({
      request: buildRequest({
        source: {
          kind: "subagent",
          parentExternalSessionId: "parent-session",
          childExternalSessionId: "child-session",
        },
      }),
      onSubmit: async () => {},
    });

    await harness.mount();

    expect(harness.asText()).toContain("Subagent request");

    await harness.unmount();
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

    expect(screen.getByRole("tablist", { name: "Questions" })).toBeTruthy();
    const architectureTab = screen.getByRole("tab", { name: /Architecture/i });
    expectActiveTabPanel(architectureTab);

    await harness.clickTabByText("Summary");
    const summaryTab = screen.getByRole("tab", { name: /Summary/i });
    expectActiveTabPanel(summaryTab);
    expect(harness.asText()).toContain("No answer yet");

    await harness.clickTabByText("Validation");
    const validationTab = screen.getByRole("tab", { name: /Validation/i });
    expectActiveTabPanel(validationTab);
    expect(harness.asText()).toContain("How should we validate this change?");
    expect(harness.asText()).not.toContain("No answer yet");

    await harness.unmount();
  });
  test("keeps question progress and free text when the request is re-projected", async () => {
    const request = buildRequest({
      questions: [
        {
          header: "First",
          question: "Pick the first answer",
          options: [{ label: "Frontend", description: "UI work" }],
          multiple: false,
        },
        {
          header: "Second",
          question: "Pick the second answer",
          options: [{ label: "Backend", description: "API work" }],
          multiple: false,
        },
      ],
    });
    const reProject = (): AgentQuestionRequest => structuredClone(request);
    const onSubmit = mock(async () => {});
    const harness = createCardHarness({ request, onSubmit });
    await harness.mount();

    await harness.clickButtonByText("Frontend");
    expectActiveTabPanel(screen.getByRole("tab", { name: /Second/i }));

    await harness.rerender({ request: reProject(), onSubmit });
    expectActiveTabPanel(screen.getByRole("tab", { name: /Second/i }));

    await harness.clickButtonByText("Other answer");
    await harness.rerender({ request: reProject(), onSubmit });

    const textarea = screen.getByPlaceholderText("Write your answer...");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Custom backend answer" } });
    });
    await harness.rerender({ request: reProject(), onSubmit });

    expect(harness.getButtonDisabled("Confirm Answers")).toBe(false);
    await harness.clickButtonByText("Confirm Answers");
    expect(onSubmit).toHaveBeenCalledWith("request-1", [["Frontend"], ["Custom backend answer"]]);

    await harness.unmount();
  });

  test("advances to the next question with Next after entering a custom answer", async () => {
    const request = buildRequest({
      questions: [
        {
          header: "First",
          question: "Pick the first answer",
          options: [{ label: "Frontend", description: "UI work" }],
          multiple: false,
        },
        {
          header: "Second",
          question: "Pick the second answer",
          options: [{ label: "Backend", description: "API work" }],
          multiple: false,
        },
      ],
    });
    const harness = createCardHarness({ request, onSubmit: async () => {} });
    await harness.mount();

    await harness.clickButtonByText("Other answer");
    const textarea = screen.getByPlaceholderText("Write your answer...");
    await act(async () => {
      fireEvent.change(textarea, { target: { value: "Custom first answer" } });
    });

    expect(harness.getButtonDisabled("Next")).toBe(false);
    await harness.clickButtonByText("Next");
    expectActiveTabPanel(screen.getByRole("tab", { name: /Second/i }));

    await harness.unmount();
  });

  test("reuses question tab and option nodes when the request is re-projected", async () => {
    const request = buildRequest({
      questions: [
        {
          header: "First",
          question: "Pick the first answer",
          options: [{ label: "Frontend", description: "UI work" }],
          multiple: false,
        },
        {
          header: "Second",
          question: "Pick the second answer",
          options: [{ label: "Backend", description: "API work" }],
          multiple: false,
        },
      ],
    });
    const onSubmit = mock(async () => {});
    const harness = createCardHarness({ request, onSubmit });
    await harness.mount();

    await harness.clickButtonByText("Frontend");
    const secondTabBefore = screen.getByRole("tab", { name: /Second/i });
    const optionBefore = screen.getByRole("button", { name: /Backend/ });

    await harness.rerender({
      request: structuredClone(request),
      onSubmit,
    });

    expect(screen.getByRole("tab", { name: /Second/i })).toBe(secondTabBefore);
    expect(screen.getByRole("button", { name: /Backend/ })).toBe(optionBefore);

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

  test("moves focus to the next question tab when Next is pressed", async () => {
    const harness = createCardHarness({
      request: buildRequest({
        questions: [
          {
            header: "First",
            question: "Pick the first answer",
            options: [{ label: "One", description: "First option" }],
            multiple: false,
          },
          {
            header: "Second",
            question: "Pick the second answer",
            options: [{ label: "Two", description: "Second option" }],
            multiple: false,
          },
        ],
      }),
      onSubmit: async () => {},
    });
    await harness.mount();

    await harness.clickButtonByText("Next");

    expect(document.activeElement).toBe(screen.getByRole("tab", { name: /Second/i }));

    await harness.unmount();
  });

  test("reset returns to the first question tab", async () => {
    const harness = createCardHarness({
      request: buildRequest({
        questions: [
          {
            header: "First",
            question: "Pick the first answer",
            options: [{ label: "One", description: "First option" }],
            multiple: false,
          },
          {
            header: "Second",
            question: "Pick the second answer",
            options: [{ label: "Two", description: "Second option" }],
            multiple: false,
          },
        ],
      }),
      onSubmit: async () => {},
    });
    await harness.mount();

    await harness.clickTabByText("Summary");
    expect(harness.asText()).toContain("No answer yet");

    await harness.clickButtonByText("Reset");

    expectActiveTabPanel(screen.getByRole("tab", { name: /First/i }));
    expect(harness.asText()).toContain("Pick the first answer");

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
