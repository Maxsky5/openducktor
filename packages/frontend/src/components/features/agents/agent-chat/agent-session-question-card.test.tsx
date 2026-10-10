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
  test("submits an empty native option value in a required multiselect", async () => {
    const request = buildRequest({
      questions: [
        {
          header: "Choice",
          question: "Choose a preference",
          multiple: true,
          required: true,
          custom: false,
          options: [{ label: "No preference", value: "", description: "Use no preference" }],
        },
      ],
    });
    const onSubmit = mock<CardProps["onSubmit"]>(async () => {});
    const harness = createCardHarness({ request, onSubmit });
    await harness.mount();
    try {
      await harness.clickButtonByText("No preference");
      expect(harness.getButtonDisabled("Confirm Answers")).toBe(false);
      expect(screen.getByText("No preference")).toBeTruthy();
      await harness.clickButtonByText("Confirm Answers");
      expect(onSubmit).toHaveBeenCalledWith("request-1", [[""]]);
    } finally {
      await harness.unmount();
    }
  });
  test("submits native option values and permits an unanswered optional field", async () => {
    const request = buildRequest({
      questions: [
        {
          header: "Choice",
          question: "Choose a value",
          required: true,
          custom: false,
          options: [
            { label: "Friendly choice", value: " native_value ", description: "A native value" },
          ],
        },
        { header: "Optional", question: "Add a note", required: false, custom: true, options: [] },
      ],
    });
    const onSubmit = mock<CardProps["onSubmit"]>(async () => {
      throw new Error("Retry native form");
    });
    const harness = createCardHarness({ request, onSubmit });
    await harness.mount();
    try {
      await harness.clickButtonByText("Friendly choice");
      await harness.clickTabByText("Summary");
      expect(harness.getButtonDisabled("Confirm Answers")).toBe(false);
      await harness.clickButtonByText("Confirm Answers");
      await waitFor(() => expect(screen.getByText("Retry native form")).toBeTruthy());
      expect(onSubmit).toHaveBeenCalledWith("request-1", [[" native_value "], []]);
      expect(screen.getByText("Friendly choice")).toBeTruthy();
      await harness.clickButtonByText("Confirm Answers");
      expect(onSubmit).toHaveBeenCalledTimes(2);
      expect(onSubmit.mock.calls[1]).toEqual(["request-1", [[" native_value "], []]]);
    } finally {
      await harness.unmount();
    }
  });
  test("keeps unsupported forms visible and permits cancellation with failed feedback", async () => {
    const request = buildRequest({
      canCancel: true,
      unsupportedReason: "Native numeric fields cannot be answered here.",
    });
    const onSubmit = mock<CardProps["onSubmit"]>(async () => {
      throw new Error("Native cancellation failed");
    });
    const harness = createCardHarness({ request, onSubmit });
    await harness.mount();
    try {
      expect(screen.getByRole("alert").textContent).toContain("Native numeric fields");
      expect(harness.getButtonDisabled("Confirm Answers")).toBe(true);
      await harness.clickButtonByText("Cancel question");
      await waitFor(() => expect(screen.getByText("Native cancellation failed")).toBeTruthy());
      expect(onSubmit).toHaveBeenCalledWith("request-1", []);
      expect(harness.getButtonDisabled("Cancel question")).toBe(false);
    } finally {
      await harness.unmount();
    }
  });

  test("collapse preserves answers, text, tabs, focus, and errors through a new visit", async () => {
    const request = buildRequest({
      questions: [
        buildRequest().questions[0]!,
        {
          header: "Details",
          question: "Give more detail",
          options: [],
        },
      ],
      source: {
        kind: "subagent",
        parentExternalSessionId: "parent",
        childExternalSessionId: "child",
      },
    });
    const onSubmit = mock(async () => {
      throw new Error("Retry this answer");
    });
    const props = { request, onSubmit, collapseResetKey: "visit-1" };
    const harness = createCardHarness(props);
    await harness.mount();
    try {
      await harness.clickButtonByText("Frontend");
      const textarea = screen.getByPlaceholderText<HTMLTextAreaElement>("Write your answer...");
      await act(async () => {
        fireEvent.change(textarea, { target: { value: "Keep this draft" } });
        textarea.focus();
      });
      const toggle = screen.getByRole("button", { name: "Collapse question request" });
      const content = document.getElementById(getRequiredAttribute(toggle, "aria-controls"));
      await act(async () => {
        fireEvent.click(screen.getByText("Input needed"));
      });
      expect(document.activeElement).toBe(toggle);
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(content?.hasAttribute("hidden")).toBe(true);
      expect(screen.queryByRole("textbox")).toBeNull();
      expect(screen.queryByRole("tablist")).toBeNull();
      expect(screen.queryByRole("button", { name: "Reset" })).toBeNull();
      expect(screen.getByText("2/2 answered")).toBeTruthy();
      expect(screen.getByText("Subagent request")).toBeTruthy();
      expect(onSubmit).not.toHaveBeenCalled();

      await harness.rerender({ ...props, request: structuredClone(request) });
      expect(screen.getByRole("button", { name: "Expand question request" })).toBeTruthy();
      await act(async () => {
        fireEvent.click(screen.getByText("2/2 answered"));
      });
      expect(screen.getByPlaceholderText("Write your answer...")).toBe(textarea);
      expect(textarea.value).toBe("Keep this draft");
      expectActiveTabPanel(screen.getByRole("tab", { name: "Details" }));
      await harness.clickTabByText("Summary");
      await harness.clickButtonByText("Confirm Answers");
      await waitFor(() => expect(screen.getByText("Retry this answer")).toBeTruthy());
      await harness.clickButtonByText("Collapse question request");
      expect(screen.getByText("Retry this answer")).toBeTruthy();
      await harness.rerender({ ...props, collapseResetKey: "visit-2" });
      expect(screen.getByRole("button", { name: "Collapse question request" })).toBeTruthy();
      expectActiveTabPanel(screen.getByRole("tab", { name: "Summary" }));
      expect(screen.getByText("Retry this answer")).toBeTruthy();
      expect(onSubmit).toHaveBeenCalledWith("request-1", [["Frontend"], ["Keep this draft"]]);
    } finally {
      await harness.unmount();
    }
  });

  test("keeps the toggle and submission feedback available while answers are disabled", async () => {
    const harness = createCardHarness({
      request: buildRequest(),
      disabled: true,
      isSubmitting: true,
      onSubmit: async () => {},
    });
    await harness.mount();
    try {
      await harness.clickButtonByText("Collapse question request");
      expect(screen.getByRole("status").textContent).toBe("Submitting answers…");
      await harness.clickButtonByText("Expand question request");
      expect(harness.getButtonDisabled("Frontend")).toBe(true);
      expect(harness.getButtonDisabled("Reset")).toBe(true);
    } finally {
      await harness.unmount();
    }
  });

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
    const onSubmit = mock<CardProps["onSubmit"]>(async () => {});
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
    const onSubmit = mock<CardProps["onSubmit"]>(async () => {});
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

  test.each([undefined, false])(
    "hides cancellation (%s) and submits normalized answers",
    async (canCancel) => {
      const onSubmit = mock<CardProps["onSubmit"]>(async () => {});
      const harness = createCardHarness({
        request: buildRequest({ canCancel }),
        onSubmit,
      });
      await harness.mount();
      try {
        expect(screen.queryByRole("button", { name: "Cancel question" })).toBeNull();
        expect(harness.getButtonDisabled("Confirm Answers")).toBe(true);

        await harness.clickButtonByText("Frontend");
        expect(harness.getButtonDisabled("Confirm Answers")).toBe(false);

        await harness.clickButtonByText("Confirm Answers");
        expect(onSubmit).toHaveBeenCalledTimes(1);
        expect(onSubmit).toHaveBeenCalledWith("request-1", [["Frontend"]]);
      } finally {
        await harness.unmount();
      }
    },
  );

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
