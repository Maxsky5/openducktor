import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHookHarness as createSharedHookHarness } from "@/test-utils/react-hook-harness";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import { QUESTION_SUMMARY_TAB_ID, useQuestionDraft } from "./use-agent-session-question-draft";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalConsoleError = console.error;

type QuestionOverride = Partial<AgentQuestionRequest["questions"][number]>;

const baseQuestion = (
  overrides: QuestionOverride = {},
): AgentQuestionRequest["questions"][number] => ({
  header: "Primary question",
  question: "Pick one option",
  options: [
    { label: "Frontend", description: "UI work" },
    { label: "Backend", description: "API work" },
  ],
  multiple: false,
  custom: true,
  ...overrides,
});

const buildRequest = (overrides: Partial<AgentQuestionRequest> = {}): AgentQuestionRequest => ({
  requestId: "request-1",
  questions: [baseQuestion()],
  ...overrides,
});

const createHookHarness = (initialRequest: AgentQuestionRequest) => {
  return createSharedHookHarness(
    ({ request }: { request: AgentQuestionRequest }) => useQuestionDraft({ request }),
    { request: initialRequest },
  );
};

describe("useQuestionDraft", () => {
  beforeEach(() => {
    console.error = (...args: unknown[]): void => {
      originalConsoleError(...args);
    };
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  test("tracks completion and builds answers for selected options", async () => {
    const harness = createHookHarness(buildRequest());
    await harness.mount();

    expect(harness.getLatest().answeredCount).toBe(0);
    expect(harness.getLatest().isComplete).toBe(false);

    await harness.run((state) => {
      state.selectOption(0, "Frontend");
    });

    const latest = harness.getLatest();
    expect(latest.answeredCount).toBe(1);
    expect(latest.isComplete).toBe(true);
    expect(latest.buildAnswers()).toEqual([["Frontend"]]);

    await harness.unmount();
  });

  test("auto advances single-choice flow to summary for multi-question requests", async () => {
    const request = buildRequest({
      questions: [
        baseQuestion({
          header: "Question 1",
          options: [{ label: "One", description: "first" }],
        }),
        baseQuestion({
          header: "Question 2",
          options: [{ label: "Two", description: "second" }],
        }),
      ],
    });
    const harness = createHookHarness(request);
    await harness.mount();

    expect(harness.getLatest().activeTabId).toBe("0");

    await harness.run((state) => {
      state.selectOption(0, "One");
    });
    expect(harness.getLatest().activeTabId).toBe("1");

    await harness.run((state) => {
      state.selectOption(1, "Two");
    });
    expect(harness.getLatest().activeTabId).toBe(QUESTION_SUMMARY_TAB_ID);

    await harness.unmount();
  });

  test("free-text mode overrides single-choice selection", async () => {
    const harness = createHookHarness(buildRequest());
    await harness.mount();

    await harness.run((state) => {
      state.selectOption(0, "Frontend");
    });

    await harness.run((state) => {
      state.toggleFreeText(0);
      state.updateFreeText(0, "Design system updates");
    });

    const latest = harness.getLatest();
    expect(latest.normalizedDraft[0]?.selectedOptionLabels).toEqual([]);
    expect(latest.normalizedDraft[0]?.useFreeText).toBe(true);
    expect(latest.buildAnswers()).toEqual([["Design system updates"]]);

    await harness.unmount();
  });

  test("preserves free-text changes when option selection is batched in same update", async () => {
    const harness = createHookHarness(
      buildRequest({
        questions: [
          baseQuestion({
            multiple: true,
            options: [
              { label: "A", description: "first" },
              { label: "B", description: "second" },
            ],
          }),
        ],
      }),
    );
    await harness.mount();

    await harness.run((state) => {
      state.toggleFreeText(0);
      state.updateFreeText(0, "Keep this note");
      state.selectOption(0, "A");
    });

    const latest = harness.getLatest();
    expect(latest.normalizedDraft[0]?.freeText).toBe("Keep this note");
    expect(latest.normalizedDraft[0]?.selectedOptionLabels).toEqual(["A"]);
    expect(latest.buildAnswers()).toEqual([["A", "Keep this note"]]);

    await harness.unmount();
  });

  test("merges multi-select options when selections happen in one batch", async () => {
    const harness = createHookHarness(
      buildRequest({
        questions: [
          baseQuestion({
            multiple: true,
            options: [
              { label: "A", description: "first" },
              { label: "B", description: "second" },
            ],
          }),
        ],
      }),
    );
    await harness.mount();

    await harness.run((state) => {
      state.selectOption(0, "A");
      state.selectOption(0, "B");
    });

    expect(harness.getLatest().normalizedDraft[0]?.selectedOptionLabels).toEqual(["A", "B"]);

    await harness.unmount();
  });

  test("resets active tab, draft, and submit error when request changes", async () => {
    const requestOne = buildRequest({
      requestId: "request-1",
      questions: [baseQuestion(), baseQuestion({ header: "Question 2" })],
    });
    const requestTwo = buildRequest({
      requestId: "request-2",
      questions: [baseQuestion({ header: "Fresh question", options: [] })],
    });

    const harness = createHookHarness(requestOne);
    await harness.mount();

    await harness.run((state) => {
      state.selectOption(0, "Frontend");
      state.setSubmitError("Submission failed");
    });
    expect(harness.getLatest().activeTabId).toBe("1");
    expect(harness.getLatest().submitError).toBe("Submission failed");

    await harness.update({ request: requestTwo });

    const latest = harness.getLatest();
    expect(latest.activeTabId).toBe("0");
    expect(latest.submitError).toBeNull();
    expect(latest.answeredCount).toBe(0);
    expect(latest.normalizedDraft[0]?.freeText).toBe("");

    await harness.unmount();
  });

  test("clears submit error when switching tabs", async () => {
    const request = buildRequest({
      questions: [baseQuestion({ header: "Question 1" }), baseQuestion({ header: "Question 2" })],
    });
    const harness = createHookHarness(request);
    await harness.mount();

    await harness.run((state) => {
      state.setSubmitError("Submission failed");
      state.setActiveTabId("1");
    });

    expect(harness.getLatest().activeTabId).toBe("1");
    expect(harness.getLatest().submitError).toBeNull();

    await harness.unmount();
  });
});
