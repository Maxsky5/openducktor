import { CheckCircle2, Circle, CircleDotDashed, ListChecks } from "lucide-react";
import type { HTMLAttributes, ReactElement } from "react";
import { useId } from "react";
import { SegmentedControlItem, SegmentedControlRoot } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import { isAgentQuestionAnswered } from "./agent-session-question-draft";
import { buildQuestionRenderEntries } from "./agent-session-question-keys";
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
  const tabGroupId = useId();

  if (request.questions.length === 0) {
    return null;
  }

  const sourceLabel = request.source?.kind === "subagent" ? "Subagent request" : null;
  const questionRenderEntries = buildQuestionRenderEntries(request.requestId, request.questions);
  const getTabId = (tabId: string): string => `${tabGroupId}-tab-${tabId}`;
  const getPanelId = (tabId: string): string => `${tabGroupId}-panel-${tabId}`;
  const getTabPanelProps = (tabId: string): HTMLAttributes<HTMLDivElement> | undefined => {
    if (!hasMultipleQuestions) {
      return undefined;
    }
    return {
      role: "tabpanel",
      id: getPanelId(tabId),
      "aria-labelledby": getTabId(tabId),
    };
  };

  return (
    <section className="rounded-xl border border-input bg-card shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-input px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2 text-foreground">
          <CircleDotDashed className="size-4 text-muted-foreground" />
          <p className="text-[13px] font-semibold">Input needed</p>
          {sourceLabel ? (
            <span className="rounded-full border border-input bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
              {sourceLabel}
            </span>
          ) : null}
        </div>
        <p className="text-[11px] font-medium text-foreground">
          {answeredCount}/{requiredCount} answered
        </p>
      </header>

      <div className="space-y-2 p-2.5">
        {hasMultipleQuestions ? (
          <SegmentedControlRoot
            role="tablist"
            size="sm"
            className="h-auto flex-wrap bg-transparent p-0"
            aria-label="Questions"
          >
            {questionRenderEntries.map(({ question, key }, index) => {
              const tabId = String(index);
              const isTabActive = activeTabId === tabId;
              const answered = isAgentQuestionAnswered(question, normalizedDraft[index]);
              return (
                <SegmentedControlItem
                  key={key}
                  active={isTabActive}
                  role="tab"
                  id={getTabId(tabId)}
                  aria-controls={getPanelId(tabId)}
                  grow="hug"
                  size="xs"
                  inactiveClassName="bg-card text-foreground hover:bg-accent"
                  className="h-7 gap-1 border border-input px-2"
                  onClick={() => setActiveTabId(tabId)}
                >
                  {answered ? (
                    <CheckCircle2
                      className={cn(
                        "size-3.5",
                        isTabActive ? "text-selected-control-foreground/70" : "text-success-accent",
                      )}
                    />
                  ) : (
                    <Circle
                      className={cn(
                        "size-3.5",
                        isTabActive
                          ? "text-selected-control-foreground/70"
                          : "text-muted-foreground",
                      )}
                    />
                  )}
                  {question.header?.trim() || `Question ${index + 1}`}
                </SegmentedControlItem>
              );
            })}
            <SegmentedControlItem
              active={isSummaryTab}
              role="tab"
              id={getTabId(QUESTION_SUMMARY_TAB_ID)}
              aria-controls={getPanelId(QUESTION_SUMMARY_TAB_ID)}
              grow="hug"
              size="xs"
              inactiveClassName="bg-card text-foreground hover:bg-muted"
              className="h-7 gap-1 border border-input px-2"
              onClick={() => setActiveTabId(QUESTION_SUMMARY_TAB_ID)}
            >
              <ListChecks className="size-3.5" />
              Summary
            </SegmentedControlItem>
          </SegmentedControlRoot>
        ) : null}

        {isSummaryTab ? (
          <QuestionSummaryTab
            request={request}
            draft={normalizedDraft}
            panelProps={getTabPanelProps(QUESTION_SUMMARY_TAB_ID)}
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
            panelProps={getTabPanelProps(String(activeQuestionIndex))}
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
