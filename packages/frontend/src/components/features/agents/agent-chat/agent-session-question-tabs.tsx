import { CheckCircle2, Circle, ListChecks } from "lucide-react";
import type { ReactElement } from "react";
import { SegmentedControlItem, SegmentedControlRoot } from "@/components/ui/segmented-control";
import { cn } from "@/lib/utils";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import {
  type AgentQuestionDraftEntry,
  isAgentQuestionAnswered,
} from "./agent-session-question-draft";
import { buildQuestionContentEntries } from "./agent-session-question-keys";
import { QUESTION_SUMMARY_TAB_ID } from "./use-agent-session-question-draft";

type QuestionTabsProps = {
  request: AgentQuestionRequest;
  draft: AgentQuestionDraftEntry[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  getTabId: (tabId: string) => string;
  getPanelId: (tabId: string) => string;
};

export function QuestionTabs({
  request,
  draft,
  activeTabId,
  onSelectTab,
  getTabId,
  getPanelId,
}: QuestionTabsProps): ReactElement {
  const entries = buildQuestionContentEntries(request.questions);

  return (
    <SegmentedControlRoot
      role="tablist"
      size="sm"
      className="h-auto flex-wrap bg-transparent p-0"
      aria-label="Questions"
    >
      {entries.map(({ question, contentKey }, index) => {
        const tabId = String(index);
        const active = activeTabId === tabId;
        const answered = isAgentQuestionAnswered(question, draft[index]);
        return (
          <SegmentedControlItem
            key={contentKey}
            active={active}
            role="tab"
            id={getTabId(tabId)}
            aria-controls={getPanelId(tabId)}
            grow="hug"
            size="xs"
            inactiveClassName="bg-card text-foreground hover:bg-accent"
            className={tabClassName(active)}
            onClick={() => onSelectTab(tabId)}
          >
            {answered ? (
              <CheckCircle2
                className={cn(
                  "size-3.5",
                  active ? "text-selected-control-foreground/70" : "text-success-accent",
                )}
              />
            ) : (
              <Circle
                className={cn(
                  "size-3.5",
                  active ? "text-selected-control-foreground/70" : "text-muted-foreground",
                )}
              />
            )}
            {question.header?.trim() || `Question ${index + 1}`}
          </SegmentedControlItem>
        );
      })}
      <SegmentedControlItem
        active={activeTabId === QUESTION_SUMMARY_TAB_ID}
        role="tab"
        id={getTabId(QUESTION_SUMMARY_TAB_ID)}
        aria-controls={getPanelId(QUESTION_SUMMARY_TAB_ID)}
        grow="hug"
        size="xs"
        inactiveClassName="bg-card text-foreground hover:bg-muted"
        className={tabClassName(activeTabId === QUESTION_SUMMARY_TAB_ID)}
        onClick={() => onSelectTab(QUESTION_SUMMARY_TAB_ID)}
      >
        <ListChecks className="size-3.5" />
        Summary
      </SegmentedControlItem>
    </SegmentedControlRoot>
  );
}

function tabClassName(active: boolean): string {
  return cn(
    "h-7 gap-1 border px-2 transition-none",
    active ? "border-transparent" : "border-input",
  );
}
