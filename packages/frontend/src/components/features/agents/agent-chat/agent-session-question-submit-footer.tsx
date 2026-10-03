import { ChevronRight, LoaderCircle, Sparkles } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";

type QuestionSubmitFooterProps = {
  disabled: boolean;
  isSubmitting: boolean;
  isComplete: boolean;
  onReset: () => void;
  onSubmit: () => void;
  onNext?: (() => void) | undefined;
};

export const QuestionSubmitFooter = ({
  disabled,
  isSubmitting,
  isComplete,
  onReset,
  onSubmit,
  onNext,
}: QuestionSubmitFooterProps): ReactElement => {
  return (
    <footer className="flex items-center justify-between gap-2 border-t border-input pt-1.5">
      <p className="text-[11px] text-muted-foreground">
        {isComplete ? "All questions answered." : "Answer all questions to confirm."}
      </p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7"
          disabled={disabled || isSubmitting}
          onClick={onReset}
        >
          Reset
        </Button>
        {onNext ? (
          <Button
            type="button"
            size="sm"
            className="h-7"
            disabled={disabled || isSubmitting}
            onClick={onNext}
          >
            Next
            <ChevronRight className="size-3.5" />
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            className="h-7"
            disabled={disabled || isSubmitting || !isComplete}
            onClick={onSubmit}
          >
            {isSubmitting ? (
              <>
                <LoaderCircle className="size-3.5 animate-spin" />
                Submitting…
              </>
            ) : (
              <>
                <Sparkles className="size-3.5" />
                Confirm Answers
              </>
            )}
          </Button>
        )}
      </div>
    </footer>
  );
};

export function QuestionFeedback({
  submitError,
  isSubmitting,
}: {
  submitError: string | null;
  isSubmitting: boolean;
}): ReactElement | null {
  return submitError || isSubmitting ? (
    <div className="space-y-2 px-2.5 pb-2.5">
      {submitError ? (
        <p className="rounded-md border border-destructive-border bg-destructive-surface px-2 py-1.5 text-xs text-destructive-muted">
          {submitError}
        </p>
      ) : null}
      {isSubmitting ? (
        <p role="status" className="text-xs text-muted-foreground">
          Submitting answers…
        </p>
      ) : null}
    </div>
  ) : null;
}
