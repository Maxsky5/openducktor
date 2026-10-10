import { describe, expect, test } from "bun:test";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import {
  type AgentQuestionDraftEntry,
  buildAgentQuestionAnswers,
  createAgentQuestionDraft,
  isAgentQuestionRequestComplete,
  normalizeAgentQuestionDraft,
  toggleAgentQuestionOption,
} from "./agent-session-question-draft";

const request: AgentQuestionRequest = {
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
    expect(draft[0]).toMatchObject({ selectedOptionValues: [], freeText: "", useFreeText: false });
    expect(draft[2]).toMatchObject({ selectedOptionValues: [], freeText: "", useFreeText: true });
  });

  test("normalizes invalid selections against available options", () => {
    const draft = normalizeAgentQuestionDraft(request, [
      { selectedOptionValues: ["A", "INVALID"], freeText: "", useFreeText: false },
      { selectedOptionValues: ["X", "Y", "Z"], freeText: "", useFreeText: false },
      { selectedOptionValues: ["INVALID"], freeText: "hello", useFreeText: true },
    ]);
    expect(draft[0]?.selectedOptionValues).toEqual(["A"]);
    expect(draft[1]?.selectedOptionValues).toEqual(["X", "Y"]);
    expect(draft[2]?.selectedOptionValues).toEqual([]);
  });

  test("single-choice toggle keeps only one selected option", () => {
    const singleChoiceQuestion = request.questions[0];
    if (!singleChoiceQuestion) {
      throw new Error("Missing single-choice test fixture");
    }
    let entry: AgentQuestionDraftEntry = {
      selectedOptionValues: [],
      freeText: "",
      useFreeText: false,
    };
    entry = toggleAgentQuestionOption(singleChoiceQuestion, entry, "A");
    expect(entry.selectedOptionValues).toEqual(["A"]);
    entry = toggleAgentQuestionOption(singleChoiceQuestion, entry, "B");
    expect(entry.selectedOptionValues).toEqual(["B"]);
    entry = toggleAgentQuestionOption(singleChoiceQuestion, entry, "B");
    expect(entry.selectedOptionValues).toEqual([]);
  });

  test("builds answers with free text overriding single-choice selection", () => {
    const draft = [
      { selectedOptionValues: ["A"], freeText: "custom single", useFreeText: true },
      { selectedOptionValues: ["X"], freeText: "custom many", useFreeText: true },
      { selectedOptionValues: [], freeText: "custom only", useFreeText: true },
    ];
    expect(buildAgentQuestionAnswers(request, draft)).toEqual([
      ["custom single"],
      ["X", "custom many"],
      ["custom only"],
    ]);
  });

  test("requires every question to be answered", () => {
    const incompleteDraft = [
      { selectedOptionValues: ["A"], freeText: "", useFreeText: false },
      { selectedOptionValues: ["X"], freeText: "", useFreeText: false },
      { selectedOptionValues: [], freeText: "", useFreeText: true },
    ];
    expect(isAgentQuestionRequestComplete(request, incompleteDraft)).toBe(false);

    const completeDraft = [
      { selectedOptionValues: ["A"], freeText: "", useFreeText: false },
      { selectedOptionValues: ["X"], freeText: "", useFreeText: false },
      { selectedOptionValues: [], freeText: "filled", useFreeText: true },
    ];
    expect(isAgentQuestionRequestComplete(request, completeDraft)).toBe(true);
  });
});
