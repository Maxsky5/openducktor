import type { AgentAsyncQuestion } from "@openducktor/contracts";
import { CircleHelp, LoaderCircle } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AgentSessionIdentity } from "@/types/agent-orchestrator";
import { useAgentAsyncQuestionDraft } from "./agent-async-question-draft-store";

export function AgentAsyncQuestionCard({
  sessionIdentity,
  question,
  disabled,
  isSubmitting,
  error,
  onSubmit,
}: {
  sessionIdentity: AgentSessionIdentity;
  question: AgentAsyncQuestion;
  disabled: boolean;
  isSubmitting: boolean;
  error?: string;
  onSubmit: (question: AgentAsyncQuestion, answer: string) => Promise<void>;
}): ReactElement {
  const { answer, setAnswer, clearAnswer } = useAgentAsyncQuestionDraft(
    sessionIdentity,
    question.questionItemId,
  );
  const canSubmit = !disabled && !isSubmitting && answer.trim().length > 0;

  return (
    <section
      className="rounded-xl border border-input bg-card shadow-sm"
      data-notification-attention-kind="question"
      data-notification-attention-id={question.questionItemId}
      tabIndex={-1}
    >
      <header className="flex items-center gap-2 border-b border-input px-3 py-2 text-foreground">
        <CircleHelp className="size-4 text-muted-foreground" aria-hidden="true" />
        <p className="text-[13px] font-semibold">Codex asked while it keeps working</p>
      </header>
      <div className="space-y-3 p-3">
        <p className="whitespace-pre-wrap text-sm text-foreground">{question.title}</p>
        {question.options ? (
          <div className="flex flex-wrap gap-2" aria-label="Suggested answers">
            {question.options.map((option, optionIndex) => (
              <Button
                key={`${optionIndex}:${option}`}
                type="button"
                size="sm"
                variant={answer === option ? "default" : "outline"}
                disabled={disabled || isSubmitting}
                onClick={() => setAnswer(option)}
              >
                {option}
              </Button>
            ))}
          </div>
        ) : null}
        <form
          className="flex items-center gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (canSubmit) {
              try {
                await onSubmit(question, answer);
                clearAnswer();
              } catch {
                return;
              }
            }
          }}
        >
          <Input
            value={answer}
            disabled={disabled || isSubmitting}
            aria-label={`Answer: ${question.title}`}
            placeholder="Type an answer"
            onChange={(event) => setAnswer(event.target.value)}
          />
          <Button type="submit" size="sm" disabled={!canSubmit}>
            {isSubmitting ? <LoaderCircle className="size-4 animate-spin" /> : "Send"}
          </Button>
        </form>
        {error ? (
          <p className="rounded-md border border-destructive-border bg-destructive-surface px-2 py-1.5 text-xs text-destructive-muted">
            {error}
          </p>
        ) : null}
      </div>
    </section>
  );
}
