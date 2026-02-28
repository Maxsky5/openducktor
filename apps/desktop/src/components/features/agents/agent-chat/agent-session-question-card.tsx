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
import { flushSync } from "react-dom";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
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
    <section className="rounded-xl border border-input bg-card shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-input px-3 py-1.5">
        <div className="flex items-center gap-2 text-foreground">
          <CircleDotDashed className="size-4 text-muted-foreground" />
          <p className="text-[13px] font-semibold">Input needed</p>
        </div>
        <p className="text-[11px] font-medium text-foreground">
          {answeredCount}/{requiredCount} answered
        </p>
      </header>

      <div className="space-y-2 p-2.5">
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
                  variant="outline"
                  className={cn(
                    "h-7 cursor-pointer border-input px-2 text-[11px]",
                    isTabActive
                      ? "bg-primary text-primary-foreground hover:bg-primary/90"
                      : "bg-card text-foreground hover:bg-accent",
                  )}
                  onClick={() => setActiveTabId(tabId)}
                >
                  {answered ? (
                    <CheckCircle2
                      className={cn(
                        "size-3.5",
                        isTabActive ? "text-primary-foreground/70" : "text-emerald-500",
                      )}
                    />
                  ) : (
                    <Circle
                      className={cn(
                        "size-3.5",
                        isTabActive ? "text-primary-foreground/70" : "text-muted-foreground",
                      )}
                    />
                  )}
                  {question.header?.trim() || `Question ${index + 1}`}
                </Button>
              );
            })}
            <Button
              type="button"
              size="sm"
              variant="outline"
              className={cn(
                "h-7 cursor-pointer border-input px-2 text-[11px]",
                isSummaryTab
                  ? "bg-sidebar-accent text-white hover:bg-sidebar-accent/90"
                  : "bg-card text-foreground hover:bg-muted",
              )}
              onClick={() => setActiveTabId(SUMMARY_TAB_ID)}
            >
              <ListChecks className="size-3.5" />
              Summary
            </Button>
          </div>
        ) : null}

        {isSummaryTab ? (
          <div className="space-y-1.5 rounded-lg border border-input bg-card p-1.5">
            {request.questions.map((question, index) => {
              const answered = isAgentQuestionAnswered(question, normalizedDraft[index]);
              return (
                <button
                  key={`${request.requestId}:summary:${question.header}:${index}`}
                  type="button"
                  className="w-full cursor-pointer rounded-md px-2 py-1 text-left hover:bg-accent"
                  onClick={() => setActiveTabId(String(index))}
                >
                  <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {answered ? (
                      <CheckCircle2 className="size-3 text-emerald-500" />
                    ) : (
                      <Circle className="size-3 text-muted-foreground" />
                    )}
                    {question.header?.trim() || `Question ${index + 1}`}
                  </p>
                  <p
                    className={cn(
                      "mt-0.5 text-xs",
                      answered ? "text-foreground" : "italic text-muted-foreground",
                    )}
                  >
                    {answerPreviewForQuestion(question, normalizedDraft[index])}
                  </p>
                </button>
              );
            })}
          </div>
        ) : activeQuestion ? (
          <div className="space-y-2">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {activeQuestion.header?.trim() || `Question ${activeQuestionIndex + 1}`}
                </p>
                <p className="text-[13px] font-medium text-foreground">{activeQuestion.question}</p>
              </div>
              {activeQuestion.multiple ? (
                <p className="inline-flex items-center gap-1 rounded-full border border-input bg-secondary px-1.5 py-0 text-[10px] font-semibold text-foreground">
                  <CheckSquare className="size-3" />
                  Multiple choice - select one or more answers
                </p>
              ) : null}
            </div>

            {activeQuestion.options.length > 0 ? (
              <div className="space-y-1">
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
                        "w-full cursor-pointer rounded-md border px-2 py-1 text-left transition-colors",
                        isSelected
                          ? "border-muted-foreground bg-secondary text-foreground"
                          : "border-border bg-card text-foreground hover:border-input hover:bg-accent",
                        (disabled || isSubmitting) && "cursor-not-allowed opacity-70",
                      )}
                      onClick={() => {
                        setSubmitError(null);
                        let shouldAdvance = false;
                        flushSync(() => {
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
                            next[activeQuestionIndex] =
                              !activeQuestion.multiple && nextEntry.selectedOptionLabels.length > 0
                                ? {
                                    ...nextEntry,
                                    useFreeText: false,
                                  }
                                : nextEntry;
                            shouldAdvance =
                              !activeQuestion.multiple &&
                              !wasSelected &&
                              nextEntry.selectedOptionLabels.length > 0;
                            return next;
                          });
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
                      <div className="flex items-start gap-1.5">
                        <span className="inline-flex size-4 shrink-0 items-center justify-center pt-0.5">
                          {activeQuestion.multiple ? (
                            isSelected ? (
                              <CheckSquare className="size-3.5 text-foreground" />
                            ) : (
                              <Square className="size-3.5 text-muted-foreground" />
                            )
                          ) : isSelected ? (
                            <CheckCircle2 className="size-3.5 text-foreground" />
                          ) : (
                            <Circle className="size-3.5 text-muted-foreground" />
                          )}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-[12px] font-medium leading-4">
                            {option.label}
                          </span>
                          <span className="block text-[10px] leading-4 text-muted-foreground">
                            {option.description}
                          </span>
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
                variant="outline"
                className={cn(
                  "h-6 cursor-pointer border-input px-2 text-[11px]",
                  activeEntry?.useFreeText
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-card text-foreground hover:bg-accent",
                )}
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
                      selectedOptionLabels:
                        !target.useFreeText && !activeQuestion.multiple
                          ? []
                          : target.selectedOptionLabels,
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
                <p className="text-[11px] text-muted-foreground">Free text answer</p>
                <Textarea
                  value={activeEntry?.freeText ?? ""}
                  disabled={disabled || isSubmitting}
                  className="min-h-16 bg-card text-sm"
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
                        selectedOptionLabels: activeQuestion.multiple
                          ? target.selectedOptionLabels
                          : [],
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
          <p className="rounded-md border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 px-2 py-1.5 text-xs text-rose-700 dark:text-rose-300">
            {submitError}
          </p>
        ) : null}

        <footer className="flex items-center justify-between gap-2 border-t border-input pt-1.5">
          <p className="text-[11px] text-muted-foreground">
            {isComplete ? "All questions answered." : "Answer all questions to confirm."}
          </p>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7"
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
              className="h-7"
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
