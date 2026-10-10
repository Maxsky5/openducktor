import { useCallback, useMemo, useState } from "react";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import {
  type AgentQuestionDraftEntry,
  buildAgentQuestionAnswers,
  createAgentQuestionDraft,
  isAgentQuestionAnswered,
  isAgentQuestionRequestComplete,
  normalizeAgentQuestionDraft,
  toggleAgentQuestionOption,
} from "./agent-session-question-draft";

export const QUESTION_SUMMARY_TAB_ID = "__summary__";

const FIRST_QUESTION_TAB_ID = "0";

type QuestionDraftUiState = {
  activeTabId: string;
  draft: AgentQuestionDraftEntry[];
};

type UseQuestionDraftArgs = {
  request: AgentQuestionRequest;
};

type UseQuestionDraftState = {
  activeTabId: string;
  setActiveTabId: (tabId: string) => void;
  submitError: string | null;
  setSubmitError: (message: string | null) => void;
  clearSubmitError: () => void;
  normalizedDraft: AgentQuestionDraftEntry[];
  answeredCount: number;
  requiredCount: number;
  isComplete: boolean;
  hasMultipleQuestions: boolean;
  isSummaryTab: boolean;
  activeQuestionIndex: number;
  activeQuestion: AgentQuestionRequest["questions"][number] | undefined;
  activeEntry: AgentQuestionDraftEntry | undefined;
  selectOption: (questionIndex: number, optionValue: string) => void;
  toggleFreeText: (questionIndex: number) => void;
  updateFreeText: (questionIndex: number, value: string) => void;
  resetDraft: () => void;
  buildAnswers: () => string[][];
};

const EMPTY_DRAFT_ENTRY: AgentQuestionDraftEntry = {
  selectedOptionValues: [],
  freeText: "",
  useFreeText: false,
};

const createInitialUiState = (request: AgentQuestionRequest): QuestionDraftUiState => ({
  activeTabId: FIRST_QUESTION_TAB_ID,
  draft: createAgentQuestionDraft(request),
});

export const useQuestionDraft = ({ request }: UseQuestionDraftArgs): UseQuestionDraftState => {
  const [uiState, setUiState] = useState<QuestionDraftUiState>(() => createInitialUiState(request));
  const [submitError, setSubmitErrorState] = useState<string | null>(null);

  const normalizedDraft = useMemo(
    () => normalizeAgentQuestionDraft(request, uiState.draft),
    [request, uiState.draft],
  );

  const answeredCount = useMemo(
    () =>
      request.questions.filter((question, index) =>
        isAgentQuestionAnswered(question, normalizedDraft[index]),
      ).length,
    [request.questions, normalizedDraft],
  );

  const requiredCount = request.questions.length;
  const isComplete = useMemo(
    () => isAgentQuestionRequestComplete(request, normalizedDraft),
    [request, normalizedDraft],
  );

  const hasMultipleQuestions = request.questions.length > 1;
  const activeTabId = uiState.activeTabId;
  const isSummaryTab = hasMultipleQuestions && activeTabId === QUESTION_SUMMARY_TAB_ID;
  const activeQuestionIndex = isSummaryTab ? -1 : Math.max(0, Number(activeTabId) || 0);
  const activeQuestion =
    activeQuestionIndex >= 0 ? request.questions[activeQuestionIndex] : undefined;
  const activeEntry = activeQuestionIndex >= 0 ? normalizedDraft[activeQuestionIndex] : undefined;

  const setSubmitError = useCallback((message: string | null) => {
    setSubmitErrorState(message);
  }, []);

  const clearSubmitError = useCallback(() => {
    setSubmitErrorState(null);
  }, []);

  const setActiveTabId = useCallback(
    (tabId: string) => {
      clearSubmitError();
      setUiState((current) => ({
        ...current,
        activeTabId: tabId,
      }));
    },
    [clearSubmitError],
  );

  const selectOption = useCallback(
    (questionIndex: number, optionValue: string): void => {
      const question = request.questions[questionIndex];
      if (!question) {
        return;
      }

      clearSubmitError();

      setUiState((current) => {
        const draft = normalizeAgentQuestionDraft(request, current.draft);
        const target = draft[questionIndex] ?? EMPTY_DRAFT_ENTRY;
        const wasSelected = target.selectedOptionValues.includes(optionValue);
        const nextEntry = toggleAgentQuestionOption(question, target, optionValue);
        const shouldAdvance =
          !question.multiple && !wasSelected && nextEntry.selectedOptionValues.length > 0;

        const selectedEntry =
          !question.multiple && nextEntry.selectedOptionValues.length > 0
            ? {
                ...nextEntry,
                useFreeText: false,
              }
            : nextEntry;
        const nextDraft = draft.map((entry, index) =>
          index === questionIndex ? selectedEntry : entry,
        );

        if (!shouldAdvance || !hasMultipleQuestions) {
          return {
            ...current,
            draft: nextDraft,
          };
        }

        const nextQuestionIndex = questionIndex + 1;
        return {
          activeTabId:
            nextQuestionIndex < request.questions.length
              ? String(nextQuestionIndex)
              : QUESTION_SUMMARY_TAB_ID,
          draft: nextDraft,
        };
      });
    },
    [request, hasMultipleQuestions, clearSubmitError],
  );

  const toggleFreeText = useCallback(
    (questionIndex: number): void => {
      const question = request.questions[questionIndex];
      if (!question) {
        return;
      }

      clearSubmitError();

      setUiState((current) => {
        const draft = normalizeAgentQuestionDraft(request, current.draft);
        const target = draft[questionIndex] ?? EMPTY_DRAFT_ENTRY;
        const updated = {
          ...target,
          useFreeText: !target.useFreeText,
          selectedOptionValues:
            !target.useFreeText && !question.multiple ? [] : target.selectedOptionValues,
        };
        return {
          ...current,
          draft: draft.map((entry, index) => (index === questionIndex ? updated : entry)),
        };
      });
    },
    [request, clearSubmitError],
  );

  const updateFreeText = useCallback(
    (questionIndex: number, value: string): void => {
      const question = request.questions[questionIndex];
      if (!question) {
        return;
      }

      clearSubmitError();

      setUiState((current) => {
        const draft = normalizeAgentQuestionDraft(request, current.draft);
        const target = draft[questionIndex] ?? {
          ...EMPTY_DRAFT_ENTRY,
          useFreeText: true,
        };
        const updated = {
          ...target,
          freeText: value,
          useFreeText: true,
          selectedOptionValues: question.multiple ? target.selectedOptionValues : [],
        };
        return {
          ...current,
          draft: draft.map((entry, index) => (index === questionIndex ? updated : entry)),
        };
      });
    },
    [request, clearSubmitError],
  );

  const resetDraft = useCallback(() => {
    clearSubmitError();
    setUiState(createInitialUiState(request));
  }, [request, clearSubmitError]);

  const buildAnswers = useCallback(
    () => buildAgentQuestionAnswers(request, normalizedDraft),
    [request, normalizedDraft],
  );

  return {
    activeTabId,
    setActiveTabId,
    submitError,
    setSubmitError,
    clearSubmitError,
    normalizedDraft,
    answeredCount,
    requiredCount,
    isComplete,
    hasMultipleQuestions,
    isSummaryTab,
    activeQuestionIndex,
    activeQuestion,
    activeEntry,
    selectOption,
    toggleFreeText,
    updateFreeText,
    resetDraft,
    buildAnswers,
  };
};
