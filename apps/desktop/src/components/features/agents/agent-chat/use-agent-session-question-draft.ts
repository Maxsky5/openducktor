import { useCallback, useEffect, useMemo, useState } from "react";
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
  selectOption: (questionIndex: number, optionLabel: string) => void;
  toggleFreeText: (questionIndex: number) => void;
  updateFreeText: (questionIndex: number, value: string) => void;
  resetDraft: () => void;
  buildAnswers: () => string[][];
};

const EMPTY_DRAFT_ENTRY: AgentQuestionDraftEntry = {
  selectedOptionLabels: [],
  freeText: "",
  useFreeText: false,
};

export const useQuestionDraft = ({ request }: UseQuestionDraftArgs): UseQuestionDraftState => {
  const [activeTabId, setActiveTabId] = useState<string>("0");
  const [draft, setDraft] = useState<AgentQuestionDraftEntry[]>(() =>
    createAgentQuestionDraft(request),
  );
  const [submitError, setSubmitErrorState] = useState<string | null>(null);

  useEffect(() => {
    setActiveTabId("0");
    setDraft(createAgentQuestionDraft(request));
    setSubmitErrorState(null);
  }, [request]);

  const normalizedDraft = useMemo(
    () => normalizeAgentQuestionDraft(request, draft),
    [request, draft],
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

  const selectOption = useCallback(
    (questionIndex: number, optionLabel: string): void => {
      const question = request.questions[questionIndex];
      if (!question) {
        return;
      }

      clearSubmitError();

      const next = normalizeAgentQuestionDraft(request, normalizedDraft);
      const target = next[questionIndex] ?? EMPTY_DRAFT_ENTRY;
      const wasSelected = target.selectedOptionLabels.includes(optionLabel);
      const nextEntry = toggleAgentQuestionOption(question, target, optionLabel);
      const shouldAdvance =
        !question.multiple && !wasSelected && nextEntry.selectedOptionLabels.length > 0;

      next[questionIndex] =
        !question.multiple && nextEntry.selectedOptionLabels.length > 0
          ? {
              ...nextEntry,
              useFreeText: false,
            }
          : nextEntry;
      setDraft(next);

      if (shouldAdvance && hasMultipleQuestions) {
        const nextQuestionIndex = questionIndex + 1;
        setActiveTabId(
          nextQuestionIndex < request.questions.length
            ? String(nextQuestionIndex)
            : QUESTION_SUMMARY_TAB_ID,
        );
      }
    },
    [request, normalizedDraft, hasMultipleQuestions, clearSubmitError],
  );

  const toggleFreeText = useCallback(
    (questionIndex: number): void => {
      const question = request.questions[questionIndex];
      if (!question) {
        return;
      }

      clearSubmitError();

      setDraft((current) => {
        const next = normalizeAgentQuestionDraft(request, current);
        const target = next[questionIndex] ?? EMPTY_DRAFT_ENTRY;
        next[questionIndex] = {
          ...target,
          useFreeText: !target.useFreeText,
          selectedOptionLabels:
            !target.useFreeText && !question.multiple ? [] : target.selectedOptionLabels,
        };
        return next;
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

      setDraft((current) => {
        const next = normalizeAgentQuestionDraft(request, current);
        const target = next[questionIndex] ?? {
          ...EMPTY_DRAFT_ENTRY,
          useFreeText: true,
        };
        next[questionIndex] = {
          ...target,
          freeText: value,
          useFreeText: true,
          selectedOptionLabels: question.multiple ? target.selectedOptionLabels : [],
        };
        return next;
      });
    },
    [request, clearSubmitError],
  );

  const resetDraft = useCallback(() => {
    clearSubmitError();
    setDraft(createAgentQuestionDraft(request));
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
