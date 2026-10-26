import { CheckCircle2, Circle } from "lucide-react";
import type { HTMLAttributes, ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { AgentQuestionRequest } from "@openducktor/frontend-core/types/agent-orchestrator";
import {
  type AgentQuestionDraftEntry,
  agentQuestionTitle,
  formatAgentQuestionAnswerPreview,
  isAgentQuestionAnswered,
} from "@openducktor/frontend-core/sessions/pending-input/agent-session-question-draft";
import { buildQuestionContentEntries } from "@openducktor/frontend-core/sessions/pending-input/agent-session-question-keys";

type QuestionSummaryTabProps = {
  request: AgentQuestionRequest;
  draft: AgentQuestionDraftEntry[];
  onSelectQuestion: (index: number) => void;
  panelProps?: HTMLAttributes<HTMLDivElement> | undefined;
};

export const QuestionSummaryTab = ({
  request,
  draft,
  onSelectQuestion,
  panelProps,
}: QuestionSummaryTabProps): ReactElement => {
  const questionContentEntries = buildQuestionContentEntries(request.questions);
  const { className: panelClassName, ...rootProps } = panelProps ?? {};

  return (
    <div
      {...rootProps}
      className={cn("space-y-1.5 rounded-lg border border-input bg-card p-1.5", panelClassName)}
    >
      {questionContentEntries.map(({ question, contentKey }, index) => {
        const answered = isAgentQuestionAnswered(question, draft[index]);
        return (
          <button
            key={contentKey}
            type="button"
            className="w-full cursor-pointer rounded-md px-2 py-1 text-left hover:bg-accent"
            onClick={() => onSelectQuestion(index)}
          >
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {answered ? (
                <CheckCircle2 className="size-3 text-success-accent" />
              ) : (
                <Circle className="size-3 text-muted-foreground" />
              )}
              {agentQuestionTitle(question, index)}
            </p>
            <p
              className={cn(
                "mt-0.5 text-xs",
                answered ? "text-foreground" : "italic text-muted-foreground",
              )}
            >
              {formatAgentQuestionAnswerPreview(question, draft[index])}
            </p>
          </button>
        );
      })}
    </div>
  );
};
