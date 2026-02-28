import { CheckCircle2, Circle } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import {
  type AgentQuestionDraftEntry,
  isAgentQuestionAnswered,
} from "./agent-session-question-draft";

type QuestionSummaryTabProps = {
  request: AgentQuestionRequest;
  draft: AgentQuestionDraftEntry[];
  onSelectQuestion: (index: number) => void;
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

export const QuestionSummaryTab = ({
  request,
  draft,
  onSelectQuestion,
}: QuestionSummaryTabProps): ReactElement => {
  return (
    <div className="space-y-1.5 rounded-lg border border-input bg-card p-1.5">
      {request.questions.map((question, index) => {
        const answered = isAgentQuestionAnswered(question, draft[index]);
        return (
          <button
            key={`${request.requestId}:summary:${question.header}:${index}`}
            type="button"
            className="w-full cursor-pointer rounded-md px-2 py-1 text-left hover:bg-accent"
            onClick={() => onSelectQuestion(index)}
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
              {answerPreviewForQuestion(question, draft[index])}
            </p>
          </button>
        );
      })}
    </div>
  );
};
