import { Info, LoaderCircle, Play } from "lucide-react";
import type { AgentSessionUsageLimit } from "@openducktor/contracts";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { useMinuteClock } from "@/lib/relative-time";
import type { AgentChatInterruptedTurnResumeModel } from "./agent-chat.types";

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
        <p className="font-medium">
          {usageLimit
            ? "The session reached its usage limit."
            : "This turn stopped before it finished."}
        </p>
        {usageLimit ? (
          <UsageLimitNotice usageLimit={usageLimit} />
        ) : (
          <p className="text-xs">Resume continues from where it stopped, without a new message.</p>
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

function UsageLimitNotice({ usageLimit }: { usageLimit: AgentSessionUsageLimit }): ReactElement {
  if (usageLimit.resetsAtEpochMs !== undefined) {
    return <UsageLimitReset resetsAtEpochMs={usageLimit.resetsAtEpochMs} />;
  }
  return (
    <p className="text-xs">
      Resume when usage is available. The runtime did not report a reset time.
    </p>
  );
}

function UsageLimitReset({ resetsAtEpochMs }: { resetsAtEpochMs: number }): ReactElement {
  const now = useMinuteClock();
  const minutes = Math.max(0, Math.ceil((resetsAtEpochMs - now) / 60_000));
  const hours = Math.floor(minutes / 60);
  const remaining = hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  if (minutes === 0) {
    return (
      <p className="text-xs">The reported reset time has passed. Select Resume to try again.</p>
    );
  }
  const resetDate = new Date(resetsAtEpochMs);
  return (
    <p className="text-xs">
      <span role="timer" aria-live="off">
        Resets in {remaining}
      </span>
      {" at "}
      <time dateTime={resetDate.toISOString()}>{resetDate.toLocaleString()}</time>
      {". Resume after the reset."}
    </p>
  );
}
