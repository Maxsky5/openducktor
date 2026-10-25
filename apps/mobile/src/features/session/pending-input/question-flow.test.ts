import { describe, expect, test } from "bun:test";
import {
  createAgentQuestionDraft,
  toggleAgentQuestionOption,
} from "@openducktor/frontend-core/sessions/pending-input/agent-session-question-draft";
import { QUESTION_SUMMARY_TAB_ID } from "@openducktor/frontend-core/sessions/pending-input/use-agent-session-question-draft";
import type { AgentQuestionRequest } from "@openducktor/frontend-core/types/agent-orchestrator";
import { buildQuestionFlowView } from "./question-flow";

const question = (
  header: string,
  overrides: Partial<AgentQuestionRequest["questions"][number]> = {},
): AgentQuestionRequest["questions"][number] => ({
  header,
  question: `${header}?`,
  options: [
    { label: "Yes", description: "Do it" },
    { label: "No", description: "Skip it" },
  ],
  ...overrides,
});

const request = (questions: AgentQuestionRequest["questions"]): AgentQuestionRequest => ({
  requestId: "request-1",
  questions,
});

describe("buildQuestionFlowView", () => {
  test("submits a single question at once, only when it has an answer", () => {
    const single = request([question("Scope")]);
    const draft = createAgentQuestionDraft(single);
    const view = buildQuestionFlowView({
      request: single,
      draft,
      activeTabId: "0",
      isComplete: false,
    });
    expect(view.progressLabel).toBeNull();
    expect(view.steps).toHaveLength(1);
    expect(view.action).toEqual({ kind: "submit", label: "Confirm Answers", enabled: false });

    const answered = buildQuestionFlowView({
      request: single,
      draft,
      activeTabId: "0",
      isComplete: true,
    });
    expect(answered.action).toMatchObject({ kind: "submit", enabled: true });
  });

  test("moves through each question, then reviews the summary before submit", () => {
    const multi = request([question("Scope"), question("Tests"), question("Docs")]);
    const draft = createAgentQuestionDraft(multi);
    const first = buildQuestionFlowView({
      request: multi,
      draft,
      activeTabId: "0",
      isComplete: false,
    });
    expect(first.progressLabel).toBe("Question 1 of 3");
    expect(first.action).toEqual({ kind: "next", label: "Next", tabId: "1" });
    expect(first.steps.map((step) => step.title)).toEqual(["Scope", "Tests", "Docs", "Summary"]);

    const last = buildQuestionFlowView({
      request: multi,
      draft,
      activeTabId: "2",
      isComplete: false,
    });
    expect(last.action).toEqual({
      kind: "review",
      label: "Review Answers",
      tabId: QUESTION_SUMMARY_TAB_ID,
    });

    const summary = buildQuestionFlowView({
      request: multi,
      draft,
      activeTabId: QUESTION_SUMMARY_TAB_ID,
      isComplete: false,
    });
    expect(summary.progressLabel).toBe("Summary");
    expect(summary.action).toMatchObject({ kind: "submit", enabled: false });
    expect(summary.summary.map((row) => row.answer)).toEqual([
      "No answer yet",
      "No answer yet",
      "No answer yet",
    ]);
  });

  test("shows option labels and answered marks in the summary", () => {
    const multi = request([question("Scope"), question("Tests", { multiple: true })]);
    const [scopeQuestion, testsQuestion] = multi.questions;
    if (!scopeQuestion || !testsQuestion) throw new Error("Expected two questions.");
    const [scopeEntry, testsEntry] = createAgentQuestionDraft(multi);
    if (!scopeEntry || !testsEntry) throw new Error("Expected two draft entries.");
    const draft = [
      toggleAgentQuestionOption(scopeQuestion, scopeEntry, "Yes"),
      toggleAgentQuestionOption(
        testsQuestion,
        toggleAgentQuestionOption(testsQuestion, testsEntry, "Yes"),
        "No",
      ),
    ];
    const summary = buildQuestionFlowView({
      request: multi,
      draft,
      activeTabId: QUESTION_SUMMARY_TAB_ID,
      isComplete: true,
    });
    expect(summary.summary).toEqual([
      { key: expect.any(String), questionIndex: 0, title: "Scope", answer: "Yes", answered: true },
      {
        key: expect.any(String),
        questionIndex: 1,
        title: "Tests",
        answer: "Yes, No",
        answered: true,
      },
    ]);
    expect(summary.steps.every((step) => step.answered)).toBe(true);
    expect(summary.action).toMatchObject({ kind: "submit", enabled: true });
  });

  test("titles a question without a header by its position", () => {
    const multi = request([question(" "), question("")]);
    const view = buildQuestionFlowView({
      request: multi,
      draft: createAgentQuestionDraft(multi),
      activeTabId: "1",
      isComplete: false,
    });
    expect(view.steps.slice(0, 2).map((step) => step.title)).toEqual(["Question 1", "Question 2"]);
  });
});
