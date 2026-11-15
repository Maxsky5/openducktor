import {
  NO_ANSWER_YET_LABEL,
  readQuestionAnswerEntries,
  readQuestionAnswerText,
} from "@openducktor/frontend-core/sessions/messages/agent-chat-tool-presentation";
import type { ToolMeta } from "@openducktor/frontend-core/sessions/messages/agent-chat-message-card-model.types";
import { CornerDownRight } from "lucide-react";
import type { ReactElement } from "react";
import { cn } from "@/lib/utils";

/**
 * The answers of a question tool under its line, one line for each question. The line of the call
 * shows the prompt of one question, so the answer of one question shows alone. Several questions
 * show the label or the prompt of each question before its answer. The tool details show the
 * options and the full text.
 */
export const QuestionToolAnswers = ({ meta }: { meta: ToolMeta }): ReactElement | null => {
  const entries = readQuestionAnswerEntries(meta);
  if (entries.length === 0) return null;
  const showsLabels = entries.length > 1;
  return (
    // The answers start under the tool name: the 14 px icon and the 8 px gap.
    <ul aria-label="Answers" data-slot="question-answers" className="space-y-0.5 pl-[22px]">
      {entries.map(({ key, detail }) => {
        const answer = readQuestionAnswerText(detail);
        return (
          <li
            key={key}
            title={answer ? `${detail.prompt}\n${answer}` : detail.prompt}
            className="flex min-w-0 items-center gap-1.5 text-xs leading-5"
          >
            <CornerDownRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
            {showsLabels ? (
              <span className="max-w-[40%] shrink-0 truncate text-muted-foreground">
                {detail.header ?? detail.prompt}
              </span>
            ) : null}
            <span
              className={cn(
                "min-w-0 truncate",
                answer ? "text-foreground" : "italic text-muted-foreground",
              )}
            >
              {answer || NO_ANSWER_YET_LABEL}
            </span>
          </li>
        );
      })}
    </ul>
  );
};
