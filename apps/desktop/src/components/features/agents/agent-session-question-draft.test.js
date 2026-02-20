import { describe, expect, test } from "bun:test";
import {
  buildAgentQuestionAnswers,
  createAgentQuestionDraft,
  isAgentQuestionRequestComplete,
  normalizeAgentQuestionDraft,
  toggleAgentQuestionOption,
} from "./agent-session-question-draft";

const request = {
  requestId: "req-1",
  questions: [
    {
      header: "Choice",
      question: "Pick one",
      options: [
        { label: "A", description: "A desc" },
        { label: "B", description: "B desc" },
      ],
    },
    {
      header: "Many",
      question: "Pick many",
      options: [
        { label: "X", description: "X desc" },
        { label: "Y", description: "Y desc" },
      ],
      multiple: true,
    },
    {
      header: "Custom",
      question: "Custom only",
      options: [],
      custom: true,
    },
  ],
};

describe("agent-session-question-draft", () => {
  test("creates initial draft with custom-only question in free text mode", () => {
    const draft = createAgentQuestionDraft(request);
    expect(draft).toHaveLength(3);
    expect(draft[0]).toMatchObject({ selectedOptionLabels: [], freeText: "", useFreeText: false });
    expect(draft[2]).toMatchObject({ selectedOptionLabels: [], freeText: "", useFreeText: true });
  });

  test("normalizes invalid selections against available options", () => {
    const draft = normalizeAgentQuestionDraft(request, [
      { selectedOptionLabels: ["A", "INVALID"], freeText: "", useFreeText: false },
      { selectedOptionLabels: ["X", "Y", "Z"], freeText: "", useFreeText: false },
      { selectedOptionLabels: ["INVALID"], freeText: "hello", useFreeText: true },
    ]);
    expect(draft[0]?.selectedOptionLabels).toEqual(["A"]);
    expect(draft[1]?.selectedOptionLabels).toEqual(["X", "Y"]);
    expect(draft[2]?.selectedOptionLabels).toEqual([]);
  });

  test("single-choice toggle keeps only one selected option", () => {
    let entry = { selectedOptionLabels: [], freeText: "", useFreeText: false };
    entry = toggleAgentQuestionOption(request.questions[0], entry, "A");
    expect(entry.selectedOptionLabels).toEqual(["A"]);
    entry = toggleAgentQuestionOption(request.questions[0], entry, "B");
    expect(entry.selectedOptionLabels).toEqual(["B"]);
    entry = toggleAgentQuestionOption(request.questions[0], entry, "B");
    expect(entry.selectedOptionLabels).toEqual([]);
  });

  test("builds answers with free text overriding single-choice selection", () => {
    const draft = [
      { selectedOptionLabels: ["A"], freeText: "custom single", useFreeText: true },
      { selectedOptionLabels: ["X"], freeText: "custom many", useFreeText: true },
      { selectedOptionLabels: [], freeText: "custom only", useFreeText: true },
    ];
    expect(buildAgentQuestionAnswers(request, draft)).toEqual([
      ["custom single"],
      ["X", "custom many"],
      ["custom only"],
    ]);
  });

  test("requires every question to be answered", () => {
    const incompleteDraft = [
      { selectedOptionLabels: ["A"], freeText: "", useFreeText: false },
      { selectedOptionLabels: ["X"], freeText: "", useFreeText: false },
      { selectedOptionLabels: [], freeText: "", useFreeText: true },
    ];
    expect(isAgentQuestionRequestComplete(request, incompleteDraft)).toBe(false);

    const completeDraft = [
      { selectedOptionLabels: ["A"], freeText: "", useFreeText: false },
      { selectedOptionLabels: ["X"], freeText: "", useFreeText: false },
      { selectedOptionLabels: [], freeText: "filled", useFreeText: true },
    ];
    expect(isAgentQuestionRequestComplete(request, completeDraft)).toBe(true);
  });
});
