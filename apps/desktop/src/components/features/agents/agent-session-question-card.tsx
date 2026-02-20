import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import {
  CheckCircle2,
  CheckSquare,
  Circle,
  CircleDotDashed,
  ListChecks,
  LoaderCircle,
  MessageSquarePlus,
  Sparkles,
  Square,
} from "lucide-react";
import { type ReactElement, useEffect, useMemo, useState } from "react";
import {
  type AgentQuestionDraftEntry,
  buildAgentQuestionAnswers,
  createAgentQuestionDraft,
  isAgentQuestionAnswered,
  isAgentQuestionRequestComplete,
  normalizeAgentQuestionDraft,
  toggleAgentQuestionOption,
} from "./agent-session-question-draft";

const SUMMARY_TAB_ID = "__summary__";

type AgentSessionQuestionCardProps = {
  request: AgentQuestionRequest;
  disabled?: boolean;
  isSubmitting?: boolean;
  onSubmit: (requestId: string, answers: string[][]) => Promise<void>;
};

const answerPreviewForQuestion = (
  question: AgentQuestionRequest["questions"][number],
  entry: AgentQuestionDraftEntry | undefined,
): string => {
  const selection = entry?.selectedOptionLabels ?? [];
  const freeText = entry?.useFreeText ? (entry.freeText ?? "").trim() : "";
  if (!question.multiple) {
    if (freeText.length > 0) {
      return freeText;
    }
    return selection[0] ?? "No answer yet";
  }
  const answers = [...selection, ...(freeText.length > 0 ? [freeText] : [])];
  return answers.length > 0 ? answers.join(", ") : "No answer yet";
};

export function AgentSessionQuestionCard({
  request,
  disabled = false,
  isSubmitting = false,
  onSubmit,
}: AgentSessionQuestionCardProps): ReactElement | null {
  const [activeTabId, setActiveTabId] = useState<string>("0");
  const [draft, setDraft] = useState<AgentQuestionDraftEntry[]>(() =>
    createAgentQuestionDraft(request),
  );
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    setActiveTabId("0");
    setDraft(createAgentQuestionDraft(request));
    setSubmitError(null);
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
    [normalizedDraft, request.questions],
  );
  const requiredCount = request.questions.length;
  const isComplete = useMemo(
    () => isAgentQuestionRequestComplete(request, normalizedDraft),
    [normalizedDraft, request],
  );
  const hasMultipleQuestions = request.questions.length > 1;
  const isSummaryTab = hasMultipleQuestions && activeTabId === SUMMARY_TAB_ID;
  const activeQuestionIndex = isSummaryTab ? -1 : Math.max(0, Number(activeTabId) || 0);
  const activeQuestion =
    activeQuestionIndex >= 0 ? request.questions[activeQuestionIndex] : undefined;
  const activeEntry = activeQuestionIndex >= 0 ? normalizedDraft[activeQuestionIndex] : undefined;

  if (request.questions.length === 0) {
    return null;
  }

  return (
    <section className="rounded-xl border border-sky-200 bg-gradient-to-b from-sky-50 to-white shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-sky-100 px-3 py-2">
        <div className="flex items-center gap-2 text-slate-800">
          <CircleDotDashed className="size-4 text-sky-600" />
          <p className="text-sm font-semibold">Input needed</p>
        </div>
        <p className="text-xs font-medium text-slate-600">
          {answeredCount}/{requiredCount} answered
        </p>
      </header>

      <div className="space-y-3 p-3">
        {hasMultipleQuestions ? (
          <div className="flex flex-wrap gap-1">
            {request.questions.map((question, index) => {
              const tabId = String(index);
              const isTabActive = activeTabId === tabId;
              const answered = isAgentQuestionAnswered(question, normalizedDraft[index]);
              return (
                <Button
                  key={`${request.requestId}:${question.header}:${index}`}
                  type="button"
                  size="sm"
                  variant={isTabActive ? "default" : "outline"}
                  className={cn("h-7 cursor-pointer px-2 text-[11px]", !isTabActive && "bg-white")}
                  onClick={() => setActiveTabId(tabId)}
                >
                  {answered ? (
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
                  ) : (
                    <Circle className="size-3.5 text-slate-400" />
                  )}
                  {question.header?.trim() || `Question ${index + 1}`}
                </Button>
              );
            })}
            <Button
              type="button"
              size="sm"
              variant={isSummaryTab ? "default" : "outline"}
              className={cn("h-7 cursor-pointer px-2 text-[11px]", !isSummaryTab && "bg-white")}
              onClick={() => setActiveTabId(SUMMARY_TAB_ID)}
            >
              <ListChecks className="size-3.5" />
              Summary
            </Button>
          </div>
        ) : null}

        {isSummaryTab ? (
          <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-2">
            {request.questions.map((question, index) => {
              const answered = isAgentQuestionAnswered(question, normalizedDraft[index]);
              return (
                <button
                  key={`${request.requestId}:summary:${question.header}:${index}`}
                  type="button"
                  className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left hover:bg-slate-50"
                  onClick={() => setActiveTabId(String(index))}
                >
                  <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {answered ? (
                      <CheckCircle2 className="size-3.5 text-emerald-500" />
                    ) : (
                      <Circle className="size-3.5 text-slate-400" />
                    )}
                    {question.header?.trim() || `Question ${index + 1}`}
                  </p>
                  <p
                    className={cn(
                      "mt-1 text-sm",
                      answered ? "text-slate-700" : "italic text-slate-500",
                    )}
                  >
                    {answerPreviewForQuestion(question, normalizedDraft[index])}
                  </p>
                </button>
              );
            })}
          </div>
        ) : activeQuestion ? (
          <div className="space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                {activeQuestion.header?.trim() || `Question ${activeQuestionIndex + 1}`}
              </p>
              <p className="mt-1 text-sm font-medium text-slate-900">{activeQuestion.question}</p>
              {activeQuestion.multiple ? (
                <p className="mt-1 inline-flex items-center gap-1 rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-700">
                  <CheckSquare className="size-3.5" />
                  Multiple choice - select one or more answers
                </p>
              ) : null}
            </div>

            {activeQuestion.options.length > 0 ? (
              <div className="space-y-2">
                {activeQuestion.options.map((option) => {
                  const isSelected = Boolean(
                    activeEntry?.selectedOptionLabels.includes(option.label),
                  );
                  return (
                    <button
                      key={`${request.requestId}:option:${activeQuestionIndex}:${option.label}`}
                      type="button"
                      disabled={disabled || isSubmitting}
                      className={cn(
                        "w-full cursor-pointer rounded-lg border px-3 py-2 text-left transition-colors",
                        isSelected
                          ? "border-sky-300 bg-sky-50 text-sky-900"
                          : "border-slate-200 bg-white text-slate-700 hover:border-slate-300 hover:bg-slate-50",
                        (disabled || isSubmitting) && "cursor-not-allowed opacity-70",
                      )}
                      onClick={() => {
                        setSubmitError(null);
                        let shouldAdvance = false;
                        setDraft((current) => {
                          const next = normalizeAgentQuestionDraft(request, current);
                          const target = next[activeQuestionIndex] ?? {
                            selectedOptionLabels: [],
                            freeText: "",
                            useFreeText: false,
                          };
                          const wasSelected = target.selectedOptionLabels.includes(option.label);
                          const nextEntry = toggleAgentQuestionOption(
                            activeQuestion,
                            target,
                            option.label,
                          );
                          next[activeQuestionIndex] = nextEntry;
                          shouldAdvance =
                            !activeQuestion.multiple &&
                            !wasSelected &&
                            nextEntry.selectedOptionLabels.length > 0;
                          return next;
                        });
                        if (shouldAdvance && hasMultipleQuestions) {
                          const nextQuestionIndex = activeQuestionIndex + 1;
                          setActiveTabId(
                            nextQuestionIndex < request.questions.length
                              ? String(nextQuestionIndex)
                              : SUMMARY_TAB_ID,
                          );
                        }
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <span className="mt-0.5 inline-flex size-4 items-center justify-center">
                          {activeQuestion.multiple ? (
                            isSelected ? (
                              <CheckSquare className="size-3.5 text-sky-600" />
                            ) : (
                              <Square className="size-3.5 text-slate-400" />
                            )
                          ) : isSelected ? (
                            <CheckCircle2 className="size-3.5 text-sky-600" />
                          ) : (
                            <Circle className="size-3.5 text-slate-400" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="text-sm font-medium">{option.label}</span>
                          <span className="block text-xs text-slate-500">{option.description}</span>
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : null}

            {activeQuestion.options.length > 0 ? (
              <Button
                type="button"
                size="sm"
                variant={activeEntry?.useFreeText ? "default" : "outline"}
                className="h-7 text-[11px]"
                disabled={disabled || isSubmitting}
                onClick={() => {
                  setSubmitError(null);
                  setDraft((current) => {
                    const next = normalizeAgentQuestionDraft(request, current);
                    const target = next[activeQuestionIndex] ?? {
                      selectedOptionLabels: [],
                      freeText: "",
                      useFreeText: false,
                    };
                    next[activeQuestionIndex] = {
                      ...target,
                      useFreeText: !target.useFreeText,
                      selectedOptionLabels: target.useFreeText ? target.selectedOptionLabels : [],
                    };
                    return next;
                  });
                }}
              >
                <MessageSquarePlus className="size-3.5" />
                Other answer
              </Button>
            ) : null}

            {activeQuestion.options.length === 0 || activeEntry?.useFreeText ? (
              <div className="space-y-1">
                <p className="text-xs text-slate-500">Free text answer</p>
                <Textarea
                  value={activeEntry?.freeText ?? ""}
                  disabled={disabled || isSubmitting}
                  className="min-h-20 bg-white"
                  placeholder="Write your answer..."
                  onChange={(event) => {
                    setSubmitError(null);
                    const value = event.currentTarget.value;
                    setDraft((current) => {
                      const next = normalizeAgentQuestionDraft(request, current);
                      const target = next[activeQuestionIndex] ?? {
                        selectedOptionLabels: [],
                        freeText: "",
                        useFreeText: true,
                      };
                      next[activeQuestionIndex] = {
                        ...target,
                        freeText: value,
                        useFreeText: true,
                        selectedOptionLabels: [],
                      };
                      return next;
                    });
                  }}
                />
              </div>
            ) : null}
          </div>
        ) : null}

        {submitError ? (
          <p className="rounded-md border border-rose-200 bg-rose-50 px-2 py-1.5 text-xs text-rose-700">
            {submitError}
          </p>
        ) : null}

        <footer className="flex items-center justify-between gap-2 border-t border-sky-100 pt-2">
          <p className="text-xs text-slate-500">
            {isComplete ? "All questions answered." : "Answer all questions to confirm."}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              disabled={disabled || isSubmitting}
              onClick={() => {
                setSubmitError(null);
                setDraft(createAgentQuestionDraft(request));
              }}
            >
              Reset
            </Button>
            <Button
              type="button"
              size="sm"
              className="h-8"
              disabled={disabled || isSubmitting || !isComplete}
              onClick={() => {
                setSubmitError(null);
                const answers = buildAgentQuestionAnswers(request, normalizedDraft);
                void onSubmit(request.requestId, answers).catch((error) => {
                  const description =
                    error instanceof Error && error.message.trim().length > 0
                      ? error.message
                      : "Failed to submit answers.";
                  setSubmitError(description);
                });
              }}
            >
              {isSubmitting ? (
                <>
                  <LoaderCircle className="size-3.5 animate-spin" />
                  Submitting...
                </>
              ) : (
                <>
                  <Sparkles className="size-3.5" />
                  Confirm Answers
                </>
              )}
            </Button>
          </div>
        </footer>
      </div>
    </section>
  );
}
