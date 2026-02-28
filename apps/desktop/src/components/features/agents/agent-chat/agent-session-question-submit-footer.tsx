import { LoaderCircle, Sparkles } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";

type QuestionSubmitFooterProps = {
  disabled: boolean;
  isSubmitting: boolean;
  isComplete: boolean;
  onReset: () => void;
  onSubmit: () => void;
};

export const QuestionSubmitFooter = ({
  disabled,
  isSubmitting,
  isComplete,
  onReset,
  onSubmit,
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
              Submitting...
            </>
          ) : (
            <>
              <Sparkles className="size-3.5" />
              Confirm Answers
            </>
          )}
        </Button>
      </div>
    </footer>
  );
};
