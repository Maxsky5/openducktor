import { CheckCircle2, Circle, CircleDotDashed, ListChecks } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import { isAgentQuestionAnswered } from "./agent-session-question-draft";
import { QuestionSubmitFooter } from "./agent-session-question-submit-footer";
import { QuestionSummaryTab } from "./agent-session-question-summary-tab";
import { QuestionTab } from "./agent-session-question-tab";
import { QUESTION_SUMMARY_TAB_ID, useQuestionDraft } from "./use-agent-session-question-draft";

type AgentSessionQuestionCardProps = {
  request: AgentQuestionRequest;
  disabled?: boolean;
  isSubmitting?: boolean;
  onSubmit: (requestId: string, answers: string[][]) => Promise<void>;
};

export function AgentSessionQuestionCard({
  request,
  disabled = false,
  isSubmitting = false,
  onSubmit,
}: AgentSessionQuestionCardProps): ReactElement | null {
  const {
    activeTabId,
    setActiveTabId,
    submitError,
    clearSubmitError,
    setSubmitError,
    normalizedDraft,
    answeredCount,
    requiredCount,
    isComplete,
    hasMultipleQuestions,
    isSummaryTab,
    activeQuestion,
    activeQuestionIndex,
    activeEntry,
    selectOption,
    toggleFreeText,
    updateFreeText,
    resetDraft,
    buildAnswers,
  } = useQuestionDraft({ request });

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
                        isTabActive ? "text-primary-foreground/70" : "text-success-accent",
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
              onClick={() => setActiveTabId(QUESTION_SUMMARY_TAB_ID)}
            >
              <ListChecks className="size-3.5" />
              Summary
            </Button>
          </div>
        ) : null}

        {isSummaryTab ? (
          <QuestionSummaryTab
            request={request}
            draft={normalizedDraft}
            onSelectQuestion={(index) => setActiveTabId(String(index))}
          />
        ) : activeQuestion ? (
          <QuestionTab
            requestId={request.requestId}
            question={activeQuestion}
            questionIndex={activeQuestionIndex}
            entry={activeEntry}
            disabled={disabled || isSubmitting}
            onSelectOption={(optionLabel) => selectOption(activeQuestionIndex, optionLabel)}
            onToggleFreeText={() => toggleFreeText(activeQuestionIndex)}
            onChangeFreeText={(value) => updateFreeText(activeQuestionIndex, value)}
          />
        ) : null}

        {submitError ? (
          <p className="rounded-md border border-destructive-border bg-destructive-surface px-2 py-1.5 text-xs text-destructive-muted">
            {submitError}
          </p>
        ) : null}

        <QuestionSubmitFooter
          disabled={disabled}
          isSubmitting={isSubmitting}
          isComplete={isComplete}
          onReset={resetDraft}
          onSubmit={() => {
            clearSubmitError();
            const answers = buildAnswers();
            void onSubmit(request.requestId, answers).catch((error) => {
              const description =
                error instanceof Error && error.message.trim().length > 0
                  ? error.message
                  : "Failed to submit answers.";
              setSubmitError(description);
            });
          }}
        />
      </div>
    </section>
  );
}
