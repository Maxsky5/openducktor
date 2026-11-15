import {
  NO_ANSWER_YET_LABEL,
  type QuestionDetailEntry,
  readToolDetailAvailability,
  readToolDetailsError,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import {
  type QuestionToolDetail,
  readQuestionAnswerChoices,
} from "@openducktor/frontend-core/sessions/messages/question-tool-parser";
import { CheckCircle2, CheckSquare, ChevronRight, Circle, Square } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { toolIcon } from "./agent-chat-tool-icon";
import {
  DetailsError,
  DetailsHeading,
  ToolCallInputOutput,
  type ToolDetailsTiming,
} from "./agent-chat-tool-details-content";
import { AgentChatTranscriptProse } from "./agent-chat-transcript-prose";

const OptionIcon = ({
  multiple,
  selected,
}: {
  multiple: boolean;
  selected: boolean;
}): ReactElement => {
  const className = cn("size-3.5", selected ? "text-foreground" : "text-muted-foreground");
  if (multiple) {
    return selected ? <CheckSquare className={className} /> : <Square className={className} />;
  }
  return selected ? <CheckCircle2 className={className} /> : <Circle className={className} />;
};

/**
 * One question: its label, its prompt, its options with the chosen ones marked, and the answers
 * that the user wrote. A question without options shows its answers as written answers.
 */
const QuestionCard = ({
  detail,
  position,
}: {
  detail: QuestionToolDetail;
  /** The place of the question among several questions, as `2 of 3`, or null for one question. */
  position: string | null;
}): ReactElement => {
  const { selectedLabels, customAnswers } = readQuestionAnswerChoices(detail);
  const isAnswered = detail.answers.length > 0;
  const facts = [position, detail.header].filter((fact) => fact !== null);
  return (
    <article
      aria-label={detail.header ?? detail.prompt}
      className="space-y-2.5 rounded-lg border border-border p-3"
    >
      <div className="space-y-1">
        {facts.length > 0 || detail.multiple ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-4 font-semibold tracking-wide text-muted-foreground uppercase">
            {facts.length > 0 ? <span>{facts.join(" · ")}</span> : null}
            {detail.multiple ? (
              <span className="rounded-full border border-border px-1.5 font-medium tracking-normal normal-case">
                Multiple choice
              </span>
            ) : null}
          </p>
        ) : null}
        <AgentChatTranscriptProse className="text-[13px] leading-5 font-medium text-foreground">
          {detail.prompt}
        </AgentChatTranscriptProse>
      </div>
      {detail.options.length > 0 ? (
        <ul aria-label="Options" className="space-y-1">
          {detail.options.map((option) => {
            const selected = selectedLabels.has(option.label);
            return (
              <li
                key={option.label}
                className={cn(
                  "flex items-start gap-2 rounded-md border px-2.5 py-1.5",
                  selected
                    ? "border-muted-foreground bg-secondary text-foreground"
                    : "border-border",
                  !selected && isAnswered && "text-muted-foreground",
                )}
              >
                <span className="flex h-5 shrink-0 items-center">
                  <OptionIcon multiple={detail.multiple} selected={selected} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs leading-5 font-medium break-words">
                    {option.label}
                    {selected ? <span className="sr-only"> (chosen)</span> : null}
                  </span>
                  {option.description ? (
                    <span className="block text-[11px] leading-4 break-words text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
      {customAnswers.length > 0 ? (
        <div className="space-y-1">
          <p className="text-[11px] leading-4 font-medium text-muted-foreground">
            {detail.options.length > 0 ? "Other answer" : "Answer"}
          </p>
          {customAnswers.map((answer) => (
            <AgentChatTranscriptProse
              key={answer}
              className="rounded-md border border-muted-foreground bg-secondary px-2.5 py-1.5 text-xs leading-5 text-foreground"
            >
              {answer}
            </AgentChatTranscriptProse>
          ))}
        </div>
      ) : null}
      {isAnswered ? null : (
        <p className="text-xs leading-5 text-muted-foreground italic">{NO_ANSWER_YET_LABEL}</p>
      )}
    </article>
  );
};

/** The raw input and output of the call, closed at first, for a reader who needs the exact data. */
const RawCallData = ({
  meta,
  workingDirectory,
}: {
  meta: ToolMeta;
  workingDirectory: string | null;
}): ReactNode => {
  const { hasInput, hasOutput } = readToolDetailAvailability(meta);
  if (!hasInput && !hasOutput) return null;
  return (
    <Collapsible className="group/raw space-y-2">
      <CollapsibleTrigger className="-ml-1 flex h-7 items-center gap-1 rounded-md px-1 text-xs font-medium text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <ChevronRight
          aria-hidden="true"
          className="size-3.5 transition-transform group-data-[state=open]/raw:rotate-90"
        />
        Raw input and output
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-4">
        <ToolCallInputOutput meta={meta} workingDirectory={workingDirectory} />
      </CollapsibleContent>
    </Collapsible>
  );
};

/**
 * The details of a question tool: the tool that the runtime called, its status and run facts, its
 * error, and each question with its options and answers. The raw input and output stay closed.
 */
export const QuestionToolDetails = ({
  meta,
  questions,
  title,
  workingDirectory,
  closeAction,
  messageTimestamp,
  timeLabel,
}: {
  meta: ToolMeta;
  /** The questions of the call, which the parser read from it. */
  questions: QuestionDetailEntry[];
  /** The name of the tool that the runtime called, such as `AskUserQuestion`. */
  title: string;
  workingDirectory: string | null;
  closeAction?: ReactNode;
} & ToolDetailsTiming): ReactElement => {
  const error = readToolDetailsError(meta);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 pt-4 pb-5">
        <DetailsHeading
          icon={toolIcon(meta)}
          title={title}
          meta={meta}
          messageTimestamp={messageTimestamp}
          timeLabel={timeLabel}
          closeAction={closeAction}
        />
        {error ? <DetailsError error={error} /> : null}
        <section aria-label="Questions" className="space-y-2">
          {questions.map(({ key, detail }, index) => (
            <QuestionCard
              key={key}
              detail={detail}
              position={questions.length > 1 ? `${index + 1} of ${questions.length}` : null}
            />
          ))}
        </section>
        <RawCallData meta={meta} workingDirectory={workingDirectory} />
      </div>
    </div>
  );
};
