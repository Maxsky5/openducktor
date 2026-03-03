import { MessageSquare, Send } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { useInlineCommentDraftStore } from "@/state/use-inline-comment-draft-store";
import { selectClearAll, selectDraftCount, selectFormatBatch } from "./selectors";

type ReviewActionsProps = {
  onSendReview: (message: string) => void;
};

export function ReviewActions({ onSendReview }: ReviewActionsProps): ReactElement | null {
  const draftCount = useInlineCommentDraftStore(selectDraftCount);
  const formatBatch = useInlineCommentDraftStore(selectFormatBatch);
  const clearAll = useInlineCommentDraftStore(selectClearAll);

  if (draftCount === 0) {
    return null;
  }

  const handleSend = (): void => {
    const message = formatBatch();
    if (message.trim().length > 0) {
      onSendReview(message);
      clearAll();
    }
  };

  return (
    <div className="flex items-center justify-between border-t border-border p-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <MessageSquare className="size-3.5" />
        <span>
          {draftCount} pending comment{draftCount > 1 ? "s" : ""}
        </span>
      </div>
      <Button
        type="button"
        size="sm"
        variant="default"
        className="h-7 gap-1.5 text-xs"
        onClick={handleSend}
      >
        <Send className="size-3" />
        Send Review
      </Button>
    </div>
  );
}
