import { Info, LoaderCircle, Play } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import type { AgentChatInterruptedTurnResumeModel } from "./agent-chat.types";

type AgentChatInterruptedTurnResumeProps = AgentChatInterruptedTurnResumeModel & {
  disabled: boolean;
};

export function AgentChatInterruptedTurnResume({
  isPending,
  error,
  disabled,
  onResume,
}: AgentChatInterruptedTurnResumeProps): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-info-border bg-info-surface px-3 py-2">
      <Info className="size-4 shrink-0 text-info-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm text-info-surface-foreground">
        <p className="font-medium">This turn stopped before it finished.</p>
        <p className="text-xs">Resume continues from where it stopped, without a new message.</p>
      </div>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="ml-auto h-8 gap-1.5"
        disabled={disabled || isPending}
        onClick={onResume}
      >
        {isPending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Play className="size-3.5" aria-hidden="true" />
        )}
        {isPending ? "Resuming" : "Resume"}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-xs text-destructive-muted">
          {error}
        </p>
      ) : null}
    </div>
  );
}
