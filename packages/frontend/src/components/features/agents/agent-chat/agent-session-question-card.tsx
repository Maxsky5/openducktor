import type { HTMLAttributes, ReactElement } from "react";
import { useId } from "react";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import { pendingInputIdentity } from "@/lib/pending-input-identity";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import { QuestionFeedback, QuestionSubmitFooter } from "./agent-session-question-submit-footer";
import { QuestionSummaryTab } from "./agent-session-question-summary-tab";
import { QuestionTabs } from "./agent-session-question-tabs";
import { QuestionTab } from "./agent-session-question-tab";
import { QUESTION_SUMMARY_TAB_ID, useQuestionDraft } from "./use-agent-session-question-draft";
import { RequestCardHeader } from "./request-card-header";
import { useRequestCardCollapse } from "./use-request-card-collapse";

type AgentSessionQuestionCardProps = {
  request: AgentQuestionRequest;
  collapseResetKey?: string;
  disabled?: boolean;
  isSubmitting?: boolean;
  onSubmit: (requestId: string, answers: string[][]) => Promise<void>;
};

export function AgentSessionQuestionCard({
  request,
  collapseResetKey = "",
  disabled = false,
  isSubmitting = false,
  onSubmit,
}: AgentSessionQuestionCardProps): ReactElement | null {
  const { isExpanded, onExpandedChange, contentRef, triggerRef } =
    useRequestCardCollapse(collapseResetKey);
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

  const firstQuestion = request.questions[0];
  const description = firstQuestion?.header.trim() || firstQuestion?.question;
  const nextQuestionIndex =
    hasMultipleQuestions &&
    activeQuestionIndex >= 0 &&
    activeQuestionIndex + 1 < request.questions.length
      ? activeQuestionIndex + 1
      : null;
  const getTabId = (tabId: string): string => `${tabGroupId}-tab-${tabId}`;
  const getPanelId = (tabId: string): string => `${tabGroupId}-panel-${tabId}`;
  const goToQuestionTab = (index: number): void => {
    const tabId = String(index);
    setActiveTabId(tabId);
    document.getElementById(getTabId(tabId))?.focus();
  };
  const getPanelProps = (tabId: string): HTMLAttributes<HTMLDivElement> | undefined => {
    if (!hasMultipleQuestions) {
      return undefined;
    }
    return {
      role: "tabpanel",
      id: getPanelId(tabId),
      "aria-labelledby": getTabId(tabId),
    };
  };

  let panel: ReactElement | null = null;
  if (isSummaryTab) {
    panel = (
      <QuestionSummaryTab
        request={request}
        draft={normalizedDraft}
        panelProps={getPanelProps(QUESTION_SUMMARY_TAB_ID)}
        onSelectQuestion={(index) => setActiveTabId(String(index))}
      />
    );
  } else if (activeQuestion) {
    panel = (
      <QuestionTab
        question={activeQuestion}
        questionIndex={activeQuestionIndex}
        entry={activeEntry}
        disabled={disabled || isSubmitting}
        onSelectOption={(optionLabel) => selectOption(activeQuestionIndex, optionLabel)}
        onToggleFreeText={() => toggleFreeText(activeQuestionIndex)}
        onChangeFreeText={(value) => updateFreeText(activeQuestionIndex, value)}
        panelProps={getPanelProps(String(activeQuestionIndex))}
      />
    );
  }

  return (
    <Collapsible open={isExpanded} onOpenChange={onExpandedChange} asChild>
      <section
        className="rounded-xl border border-input bg-card shadow-sm"
        data-notification-attention-kind="question"
        data-notification-attention-id={pendingInputIdentity(request)}
        tabIndex={-1}
      >
        <RequestCardHeader
          kind="question"
          description={description}
          isSubagent={request.source?.kind === "subagent"}
          status={
            <>
              {answeredCount}/{requiredCount} answered
            </>
          }
          isExpanded={isExpanded}
          triggerRef={triggerRef}
        />

        <CollapsibleContent
          forceMount
          ref={contentRef}
          hidden={!isExpanded}
          style={{ display: isExpanded ? undefined : "none" }}
          className="space-y-2 border-t border-input p-2.5"
        >
          {hasMultipleQuestions ? (
            <QuestionTabs
              request={request}
              draft={normalizedDraft}
              activeTabId={activeTabId}
              onSelectTab={setActiveTabId}
              getTabId={getTabId}
              getPanelId={getPanelId}
            />
          ) : null}

          {panel}

          <QuestionSubmitFooter
            disabled={disabled}
            isSubmitting={isSubmitting}
            isComplete={isComplete}
            onReset={resetDraft}
            onNext={
              nextQuestionIndex === null ? undefined : () => goToQuestionTab(nextQuestionIndex)
            }
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
        </CollapsibleContent>
        <QuestionFeedback submitError={submitError} isSubmitting={isSubmitting} />
      </section>
    </Collapsible>
  );
}
