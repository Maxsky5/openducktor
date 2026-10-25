import { Info, LoaderCircle, Play } from "lucide-react";
import type { AgentSessionUsageLimit } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { useMinuteClock } from "@openducktor/frontend-core/lib/relative-time";
import type { AgentChatInterruptedTurnResumeModel } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import {
  INTERRUPTED_TURN_COPY,
  interruptedTurnTitle,
  usageLimitCountdown,
} from "@openducktor/frontend-core/sessions/session-view/interrupted-turn-copy";

type AgentChatInterruptedTurnResumeProps = AgentChatInterruptedTurnResumeModel & {
  disabled: boolean;
};

export function AgentChatInterruptedTurnResume({
  isPending,
  error,
  disabled,
  onResume,
  usageLimit,
}: AgentChatInterruptedTurnResumeProps): ReactElement {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-info-border bg-info-surface px-3 py-2">
      <Info className="size-4 shrink-0 text-info-accent" aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm text-info-surface-foreground">
        <p className="font-medium">{interruptedTurnTitle(usageLimit)}</p>
        {usageLimit ? (
          <UsageLimitNotice usageLimit={usageLimit} />
        ) : (
          <p className="text-xs">{INTERRUPTED_TURN_COPY.stoppedDetail}</p>
        )}
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
        {isPending ? INTERRUPTED_TURN_COPY.resuming : INTERRUPTED_TURN_COPY.resume}
      </Button>
      {error ? (
        <p role="alert" className="w-full text-xs text-destructive-muted">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function UsageLimitNotice({ usageLimit }: { usageLimit: AgentSessionUsageLimit }): ReactElement {
  if (usageLimit.resetsAtEpochMs !== undefined) {
    return <UsageLimitReset resetsAtEpochMs={usageLimit.resetsAtEpochMs} />;
  }
  return <p className="text-xs">{INTERRUPTED_TURN_COPY.usageLimitWithoutReset}</p>;
}

function UsageLimitReset({ resetsAtEpochMs }: { resetsAtEpochMs: number }): ReactElement {
  const now = useMinuteClock();
  const countdown = usageLimitCountdown(resetsAtEpochMs, now);
  if (countdown.kind === "passed") {
    return <p className="text-xs">{INTERRUPTED_TURN_COPY.usageLimitResetPassed}</p>;
  }
  const resetDate = countdown.resetsAt;
  return (
    <p className="text-xs">
      <span role="timer" aria-live="off">
        Resets in {countdown.remaining}
      </span>
      {" at "}
      <time dateTime={resetDate.toISOString()}>{resetDate.toLocaleString()}</time>
      {`. ${INTERRUPTED_TURN_COPY.resumeAfterReset}`}
    </p>
  );
}
