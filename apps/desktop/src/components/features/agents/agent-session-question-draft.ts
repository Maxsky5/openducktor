import type { AgentQuestionRequest } from "@/types/agent-orchestrator";

export type AgentQuestionDraftEntry = {
  selectedOptionLabels: string[];
  freeText: string;
  useFreeText: boolean;
};

const uniqueNonEmpty = (values: string[]): string[] => {
  const deduped = new Set<string>();
  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return [...deduped];
};

const availableOptionLabels = (question: AgentQuestionRequest["questions"][number]): Set<string> =>
  new Set(
    question.options.map((option) => option.label.trim()).filter((label) => label.length > 0),
  );

const normalizeSelectionForQuestion = (
  question: AgentQuestionRequest["questions"][number],
  selection: string[],
): string[] => {
  const allowed = availableOptionLabels(question);
  const filtered = uniqueNonEmpty(selection).filter((label) => allowed.has(label));
  return question.multiple ? filtered : filtered.slice(0, 1);
};

export const createAgentQuestionDraft = (
  request: AgentQuestionRequest,
): AgentQuestionDraftEntry[] => {
  return request.questions.map((question) => ({
    selectedOptionLabels: [],
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
      selectedOptionLabels: normalizeSelectionForQuestion(
        question,
        current?.selectedOptionLabels ?? [],
      ),
      freeText: current?.freeText ?? "",
      useFreeText: Boolean(current?.useFreeText) || question.options.length === 0,
    };
  });
};

export const toggleAgentQuestionOption = (
  question: AgentQuestionRequest["questions"][number],
  entry: AgentQuestionDraftEntry,
  optionLabel: string,
): AgentQuestionDraftEntry => {
  const normalizedLabel = optionLabel.trim();
  if (!normalizedLabel) {
    return entry;
  }

  if (question.multiple) {
    const nextSelection = entry.selectedOptionLabels.includes(normalizedLabel)
      ? entry.selectedOptionLabels.filter((value) => value !== normalizedLabel)
      : [...entry.selectedOptionLabels, normalizedLabel];
    return {
      ...entry,
      selectedOptionLabels: normalizeSelectionForQuestion(question, nextSelection),
    };
  }

  const isSelected = entry.selectedOptionLabels.includes(normalizedLabel);
  return {
    ...entry,
    selectedOptionLabels: isSelected ? [] : [normalizedLabel],
  };
};

export const buildAgentQuestionAnswers = (
  request: AgentQuestionRequest,
  draft: AgentQuestionDraftEntry[],
): string[][] => {
  return request.questions.map((question, index) => {
    const entry = draft[index];
    const selected = normalizeSelectionForQuestion(question, entry?.selectedOptionLabels ?? []);
    const freeText = entry?.useFreeText ? (entry.freeText ?? "").trim() : "";

    if (!question.multiple) {
      if (freeText.length > 0) {
        return [freeText];
      }
      return selected.slice(0, 1);
    }

    if (freeText.length === 0) {
      return selected;
    }
    return uniqueNonEmpty([...selected, freeText]);
  });
};

export const isAgentQuestionAnswered = (
  question: AgentQuestionRequest["questions"][number],
  entry: AgentQuestionDraftEntry | undefined,
): boolean => {
  const selected = normalizeSelectionForQuestion(question, entry?.selectedOptionLabels ?? []);
  const freeText = entry?.useFreeText ? (entry.freeText ?? "").trim() : "";
  return selected.length > 0 || freeText.length > 0;
};

export const isAgentQuestionRequestComplete = (
  request: AgentQuestionRequest,
  draft: AgentQuestionDraftEntry[],
): boolean => {
  return request.questions.every((question, index) =>
    isAgentQuestionAnswered(question, draft[index]),
  );
};
