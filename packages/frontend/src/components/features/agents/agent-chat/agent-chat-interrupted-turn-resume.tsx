import { Info, LoaderCircle, Play, X } from "lucide-react";
import { Fragment, type ReactElement } from "react";
import { Button } from "@/components/ui/button";
import type { AgentChatInterruptedTurnResumeModel } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import { INTERRUPTED_TURN_COPY } from "@openducktor/frontend-core/sessions/session-view/interrupted-turn-copy";
import {
  buildInterruptedTurnNotice,
  type InterruptedTurnDetail,
} from "@openducktor/frontend-core/sessions/session-view/interrupted-turn-notice";
import { useInterruptedTurnClock } from "@openducktor/frontend-core/sessions/session-view/use-interrupted-turn-clock";
import { useUsageLimitAutoResumeCancel } from "@openducktor/frontend-core/sessions/session-view/use-usage-limit-auto-resume-cancel";

type AgentChatInterruptedTurnResumeProps = AgentChatInterruptedTurnResumeModel & {
  disabled: boolean;
};

export function AgentChatInterruptedTurnResume({
  isPending,
  error,
  disabled,
  onResume,
  usageLimit,
  autoResume,
  onCancelAutoResume,
}: AgentChatInterruptedTurnResumeProps): ReactElement {
  const now = useInterruptedTurnClock(usageLimit, autoResume);
  const autoResumeCancel = useUsageLimitAutoResumeCancel(autoResume, onCancelAutoResume);
  const notice = buildInterruptedTurnNotice({
    usageLimit,
    autoResume,
    isResuming: isPending,
    resumeError: error,
    now,
  });
  const shownError = notice.error ?? autoResumeCancel.error;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-info-border bg-info-surface px-3 py-2">
      <Info className="size-4 shrink-0 text-info-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm text-info-surface-foreground">
        <p className="font-medium">{notice.title}</p>
        <NoticeDetail detail={notice.detail} />
      </div>
      <div className="ml-auto flex items-center gap-2">
        {notice.canCancelAutoResume ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-8 gap-1.5"
            disabled={disabled || autoResumeCancel.isCanceling}
            onClick={autoResumeCancel.cancel}
          >
            {autoResumeCancel.isCanceling ? (
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <X className="size-3.5" aria-hidden="true" />
            )}
            {autoResumeCancel.isCanceling
              ? INTERRUPTED_TURN_COPY.canceling
              : INTERRUPTED_TURN_COPY.cancelAutoResume}
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          disabled={disabled || notice.isResuming}
          onClick={onResume}
        >
          {notice.isResuming ? (
            <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <Play className="size-3.5" aria-hidden="true" />
          )}
          {notice.isResuming ? INTERRUPTED_TURN_COPY.resuming : INTERRUPTED_TURN_COPY.resume}
        </Button>
      </div>
      {shownError ? (
        <p role="alert" className="w-full text-xs text-destructive-muted">
          {shownError}
        </p>
      ) : null}
    </div>
  );
}

function NoticeDetail({ detail }: { detail: InterruptedTurnDetail }): ReactElement {
  return (
    <p className="text-xs">
      {detail.map((part) => {
        // The pieces of one line differ, so their content is a stable key.
        switch (part.kind) {
          case "text":
            return <Fragment key={`text:${part.text}`}>{part.text}</Fragment>;
          case "time":
            return (
              <time key="time" dateTime={part.time.toISOString()}>
                {part.time.toLocaleString()}
              </time>
            );
          case "timer":
            return (
              <span key="timer" role="timer" aria-live="off">
                {part.text}
              </span>
            );
        }
      })}
    </p>
  );
}
