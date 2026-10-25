import type { AgentQuestionRequest } from "../../types/agent-orchestrator";

export type AgentQuestionDraftEntry = {
  selectedOptionValues: string[];
  freeText: string;
  useFreeText: boolean;
};

const uniqueValues = (values: string[]): string[] => [...new Set(values)];

const availableOptionValues = (question: AgentQuestionRequest["questions"][number]): Set<string> =>
  new Set(question.options.map((option) => option.value ?? option.label.trim()));

const normalizeSelectionForQuestion = (
  question: AgentQuestionRequest["questions"][number],
  selection: string[],
): string[] => {
  const allowed = availableOptionValues(question);
  const filtered = uniqueValues(selection).filter((value) => allowed.has(value));
  return question.multiple ? filtered : filtered.slice(0, 1);
};

export const createAgentQuestionDraft = (
  request: AgentQuestionRequest,
): AgentQuestionDraftEntry[] => {
  return request.questions.map((question) => ({
    selectedOptionValues: [],
    freeText: "",
    useFreeText: question.options.length === 0,
  }));
};

export const normalizeAgentQuestionDraft = (
  request: AgentQuestionRequest,
  draft: AgentQuestionDraftEntry[] | undefined,
): AgentQuestionDraftEntry[] => {
  return request.questions.map((question, index) => {
    const current = draft?.[index];
    return {
      selectedOptionValues: normalizeSelectionForQuestion(
        question,
        current?.selectedOptionValues ?? [],
      ),
      freeText: current?.freeText ?? "",
      useFreeText:
        question.options.length === 0 ||
        (question.custom !== false && Boolean(current?.useFreeText)),
    };
  });
};

export const toggleAgentQuestionOption = (
  question: AgentQuestionRequest["questions"][number],
  entry: AgentQuestionDraftEntry,
  optionValue: string,
): AgentQuestionDraftEntry => {
  if (!availableOptionValues(question).has(optionValue)) {
    return entry;
  }

  if (question.multiple) {
    const nextSelection = entry.selectedOptionValues.includes(optionValue)
      ? entry.selectedOptionValues.filter((value) => value !== optionValue)
      : [...entry.selectedOptionValues, optionValue];
    return {
      ...entry,
      selectedOptionValues: normalizeSelectionForQuestion(question, nextSelection),
    };
  }

  const isSelected = entry.selectedOptionValues.includes(optionValue);
  return {
    ...entry,
    selectedOptionValues: isSelected ? [] : [optionValue],
  };
};

export const buildAgentQuestionAnswers = (
  request: AgentQuestionRequest,
  draft: AgentQuestionDraftEntry[],
): string[][] => {
  return request.questions.map((question, index) => {
    const entry = draft[index];
    const selected = normalizeSelectionForQuestion(question, entry?.selectedOptionValues ?? []);
    const freeText = entry?.useFreeText ? (entry.freeText ?? "") : "";

    if (!question.multiple) {
      if (freeText.length > 0) {
        return [freeText];
      }
      return selected.slice(0, 1);
    }

    if (freeText.length === 0) {
      return selected;
    }
    return uniqueValues([...selected, freeText]);
  });
};

export const isAgentQuestionAnswered = (
  question: AgentQuestionRequest["questions"][number],
  entry: AgentQuestionDraftEntry | undefined,
): boolean => {
  const selected = normalizeSelectionForQuestion(question, entry?.selectedOptionValues ?? []);
  const freeText = entry?.useFreeText ? (entry.freeText ?? "") : "";
  const hasSelection = question.multiple
    ? selected.length > 0
    : selected.some((value) => value.length > 0);
  return question.required === false || hasSelection || freeText.length > 0;
};

export const isAgentQuestionRequestComplete = (
  request: AgentQuestionRequest,
  draft: AgentQuestionDraftEntry[],
): boolean => {
  return (
    !request.unsupportedReason &&
    request.questions.length === draft.length &&
    request.questions.every((question, index) => isAgentQuestionAnswered(question, draft[index]))
  );
};

/** The short title of a question: its header, or its position when it has none. */
export const agentQuestionTitle = (
  question: AgentQuestionRequest["questions"][number],
  questionIndex: number,
): string => question.header?.trim() || `Question ${questionIndex + 1}`;

export const NO_ANSWER_PREVIEW = "No answer yet";

/** The answer that a summary shows for one question, with option labels instead of values. */
export const formatAgentQuestionAnswerPreview = (
  question: AgentQuestionRequest["questions"][number],
  entry: AgentQuestionDraftEntry | undefined,
): string => {
  const selection = (entry?.selectedOptionValues ?? []).map(
    (value) =>
      question.options.find((option) => (option.value ?? option.label) === value)?.label ?? value,
  );
  const freeText = entry?.useFreeText ? (entry.freeText ?? "").trim() : "";
  if (!question.multiple) {
    if (freeText.length > 0) {
      return freeText;
    }
    return selection[0] ?? NO_ANSWER_PREVIEW;
  }
  const answers = [...selection, ...(freeText.length > 0 ? [freeText] : [])];
  return answers.length > 0 ? answers.join(", ") : NO_ANSWER_PREVIEW;
};

/** The footer hint of a Structured Question. */
export const agentQuestionCompletionText = (isComplete: boolean): string =>
  isComplete ? "All questions answered." : "Answer all questions to confirm.";
