import type { AgentToolDenial } from "@openducktor/contracts";
import {
  readToolDenialPresentation,
  TOOL_DENIAL_ALLOW_HINT,
  TOOL_DENIAL_ALLOWED_MESSAGE,
  type ToolDenialRiskTone,
} from "@openducktor/frontend-core/sessions/messages/tool-denial";
import { useDeniedToolAction } from "@openducktor/frontend-core/sessions/messages/use-denied-tool-action";
import { Check, LoaderCircle, ShieldAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RISK_TONE_CLASS_NAMES = {
  neutral: "border-border bg-muted text-muted-foreground",
  warning: "border-warning-border bg-warning-surface text-warning-muted",
  danger: "border-destructive-border bg-destructive-surface text-destructive-muted",
} as const satisfies Record<ToolDenialRiskTone, string>;

/**
 * Why a policy blocked a call, under its tool line. A call that the user can allow has an Allow
 * footer until the user allows it. The reason wraps, so the reader always sees all of it.
 */
export const ToolDenialNotice = ({
  callId,
  denial,
}: {
  callId: string;
  denial: AgentToolDenial;
}): ReactElement => {
  const { label, reason, risk } = readToolDenialPresentation(denial);
  return (
    <section
      role="note"
      aria-label={label}
      data-slot="tool-denial"
      className="ml-[22px] min-w-0 overflow-hidden rounded-lg border border-border bg-card text-xs"
    >
      <div className="flex min-w-0 items-start gap-2.5 px-3 py-2.5">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md border border-warning-border bg-warning-surface text-warning-accent">
          <ShieldAlert aria-hidden="true" className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-[13px] font-medium leading-6 text-foreground">{label}</p>
            {risk ? (
              <span
                className={cn(
                  "rounded-full border px-2 text-[11px] font-medium leading-[18px]",
                  RISK_TONE_CLASS_NAMES[risk.tone],
                )}
              >
                {risk.label}
              </span>
            ) : null}
          </div>
          {reason ? (
            <p className="whitespace-pre-wrap leading-5 text-muted-foreground [overflow-wrap:anywhere]">
              {reason}
            </p>
          ) : null}
        </div>
      </div>
      <DeniedToolActionFooter callId={callId} />
    </section>
  );
};

/** The Allow button and its note, its progress, or the note that the user allowed the call. */
const DeniedToolActionFooter = ({ callId }: { callId: string }): ReactElement | null => {
  const action = useDeniedToolAction(callId);
  if (!action) return null;
  const failure = action.failure ? (
    <p role="alert" className="w-full leading-5 text-destructive-muted [overflow-wrap:anywhere]">
      {action.failure}
    </p>
  ) : null;
  if (action.state === "allowed") {
    return (
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 border-t border-success-border bg-success-surface px-3 py-2 text-success-muted">
        <Check aria-hidden="true" className="size-3.5 shrink-0" />
        <p className="leading-5">{TOOL_DENIAL_ALLOWED_MESSAGE}</p>
        {failure}
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 border-t border-border bg-muted/40 px-3 py-2">
      <p className="leading-5 text-muted-foreground">{TOOL_DENIAL_ALLOW_HINT}</p>
      <Button
        type="button"
        size="xs"
        disabled={action.isSending}
        aria-busy={action.isSending}
        onClick={action.allow}
      >
        {action.isSending ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-3 animate-spin motion-reduce:animate-none"
          />
        ) : null}
        {action.isSending ? "Allowing" : "Allow"}
      </Button>
      {failure}
    </div>
  );
};
