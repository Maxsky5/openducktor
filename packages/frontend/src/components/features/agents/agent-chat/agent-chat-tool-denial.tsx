import type { AgentToolDenial } from "@openducktor/contracts";
import {
  readToolDenialPresentation,
  TOOL_DENIAL_ALLOW_LABEL,
  TOOL_DENIAL_ALLOWED_DETAIL,
  TOOL_DENIAL_ALLOWED_LABEL,
  TOOL_DENIAL_ALLOWING_LABEL,
  type ToolDenialRiskTone,
} from "@openducktor/frontend-core/sessions/messages/tool-denial";
import {
  type DeniedToolAction,
  useDeniedToolAction,
} from "@openducktor/frontend-core/sessions/messages/use-denied-tool-action";
import { Check, LoaderCircle, ShieldAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const RISK_TONE_CLASS_NAMES = {
  neutral: "border-border text-muted-foreground",
  warning: "border-warning-border text-warning-muted",
  danger: "border-destructive-border text-destructive-muted",
} as const satisfies Record<ToolDenialRiskTone, string>;

/**
 * Why a policy blocked a call, under its tool line. The reason wraps under the label, and the
 * Allow action follows it while the user can allow the call.
 */
export const ToolDenialNotice = ({
  callId,
  denial,
}: {
  callId: string;
  denial: AgentToolDenial;
}): ReactElement => {
  const { label, category, reason, risk } = readToolDenialPresentation(denial);
  const action = useDeniedToolAction(callId);
  const detail = category ?? reason;
  return (
    <section
      role="note"
      aria-label={label}
      data-slot="tool-denial"
      className="ml-[22px] min-w-0 rounded-lg border border-warning-border/50 bg-card px-3.5 py-3 text-xs"
    >
      <div className="flex min-w-0 items-center gap-2">
        <ShieldAlert aria-hidden="true" className="size-3.5 shrink-0 text-warning-accent" />
        <p className="min-w-0 font-medium leading-5 text-foreground">{label}</p>
        {risk ? (
          <span
            className={cn(
              "shrink-0 rounded-full border px-2 text-[11px] font-medium leading-4",
              RISK_TONE_CLASS_NAMES[risk.tone],
            )}
          >
            {risk.label}
          </span>
        ) : null}
      </div>
      {/* The text and the action start under the label: the 14 px icon and the 8 px gap. */}
      <div className="pl-[22px]">
        {detail ? (
          <p className="mt-1 whitespace-pre-wrap leading-[18px] text-muted-foreground [overflow-wrap:anywhere]">
            {detail}
          </p>
        ) : null}
        {action ? <DeniedToolActionRow action={action} /> : null}
      </div>
    </section>
  );
};

/** The Allow button and its progress, or the note that the user allowed the call. */
const DeniedToolActionRow = ({ action }: { action: DeniedToolAction }): ReactElement => {
  const failure = action.failure ? (
    <p role="alert" className="leading-5 text-destructive-muted [overflow-wrap:anywhere]">
      {action.failure}
    </p>
  ) : null;
  if (action.state === "allowed") {
    return (
      // The check sits in the shield column, so the text starts under the label.
      <div className="mt-3 -ml-[22px] space-y-1">
        <p className="flex items-start gap-2 leading-5">
          {/* Centered on the first line: the 20 px line and the 14 px icon. */}
          <Check aria-hidden="true" className="mt-[3px] size-3.5 shrink-0 text-success-muted" />
          <span>
            <span className="text-success-muted">{TOOL_DENIAL_ALLOWED_LABEL}</span>{" "}
            <span className="text-muted-foreground">{TOOL_DENIAL_ALLOWED_DETAIL}</span>
          </span>
        </p>
        <div className="pl-[22px]">{failure}</div>
      </div>
    );
  }
  return (
    // The reason line has half leading under it, so the button row needs less space above it.
    <div className="mt-2 space-y-1.5">
      <Button
        type="button"
        variant="warning"
        size="sm"
        className="h-7 gap-1.5 px-3"
        disabled={action.isSending}
        aria-busy={action.isSending}
        onClick={action.allow}
      >
        {action.isSending ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-3.5 animate-spin motion-reduce:animate-none"
          />
        ) : null}
        {action.isSending ? TOOL_DENIAL_ALLOWING_LABEL : TOOL_DENIAL_ALLOW_LABEL}
      </Button>
      {failure}
    </div>
  );
};
