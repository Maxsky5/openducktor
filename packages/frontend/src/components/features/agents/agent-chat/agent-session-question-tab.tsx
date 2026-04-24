import { CheckCircle2, CheckSquare, Circle, MessageSquarePlus, Square } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AgentQuestionRequest } from "@/types/agent-orchestrator";
import type { AgentQuestionDraftEntry } from "./agent-session-question-draft";

type QuestionTabProps = {
  requestId: string;
  question: AgentQuestionRequest["questions"][number];
  questionIndex: number;
  entry: AgentQuestionDraftEntry | undefined;
  disabled: boolean;
  onSelectOption: (optionLabel: string) => void;
  onToggleFreeText: () => void;
  onChangeFreeText: (value: string) => void;
};

export const QuestionTab = ({
  requestId,
  question,
  questionIndex,
  entry,
  disabled,
  onSelectOption,
  onToggleFreeText,
  onChangeFreeText,
}: QuestionTabProps): ReactElement => {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            {question.header?.trim() || `Question ${questionIndex + 1}`}
          </p>
          <p className="text-[13px] font-medium text-foreground">{question.question}</p>
        </div>
        {question.multiple ? (
          <p className="inline-flex items-center gap-1 rounded-full border border-input bg-secondary px-1.5 py-0 text-[10px] font-semibold text-foreground">
            <CheckSquare className="size-3" />
            Multiple choice - select one or more answers
          </p>
        ) : null}
      </div>

      {question.options.length > 0 ? (
        <div className="space-y-1">
          {question.options.map((option) => {
            const isSelected = Boolean(entry?.selectedOptionLabels.includes(option.label));
            return (
              <button
                key={`${requestId}:option:${questionIndex}:${option.label}`}
                type="button"
                disabled={disabled}
                className={cn(
                  "w-full cursor-pointer rounded-md border px-2 py-1 text-left transition-colors",
                  isSelected
                    ? "border-muted-foreground bg-secondary text-foreground"
                    : "border-border bg-card text-foreground hover:border-input hover:bg-accent",
                  disabled && "cursor-not-allowed opacity-70",
                )}
                onClick={() => onSelectOption(option.label)}
              >
                <div className="flex items-start gap-1.5">
                  <span className="inline-flex size-4 shrink-0 items-center justify-center pt-0.5">
                    {question.multiple ? (
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
                    <span className="block text-[12px] font-medium leading-4">{option.label}</span>
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

      {question.options.length > 0 ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className={cn(
            "h-6 cursor-pointer border-input px-2 text-[11px]",
            entry?.useFreeText
              ? "bg-primary text-primary-foreground hover:bg-primary/90"
              : "bg-card text-foreground hover:bg-accent",
          )}
          disabled={disabled}
          onClick={onToggleFreeText}
        >
          <MessageSquarePlus className="size-3.5" />
          Other answer
        </Button>
      ) : null}

      {question.options.length === 0 || entry?.useFreeText ? (
        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">Free text answer</p>
          <Textarea
            value={entry?.freeText ?? ""}
            disabled={disabled}
            className="min-h-16 bg-card text-sm"
            placeholder="Write your answer..."
            onChange={(event) => onChangeFreeText(event.currentTarget.value)}
          />
        </div>
      ) : null}
    </div>
  );
};
