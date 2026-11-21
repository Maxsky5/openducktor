import type { AgentToolDenial } from "@openducktor/contracts";
import {
  readToolDenialPresentation,
  TOOL_DENIAL_ALLOW_HINT,
  TOOL_DENIAL_ALLOWED_LABEL,
  TOOL_DENIAL_ALLOWED_MESSAGE,
  type ToolDenialRiskTone,
} from "@openducktor/frontend-core/sessions/messages/tool-denial";
import {
  type DeniedToolAction,
  useDeniedToolAction,
} from "@openducktor/frontend-core/sessions/messages/use-denied-tool-action";
import { Check, LoaderCircle, ShieldAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const RISK_TONE_CLASS_NAMES = {
  neutral: "border-border text-muted-foreground",
  warning: "border-warning-border text-warning-muted",
  danger: "border-destructive-border text-destructive-muted",
} as const satisfies Record<ToolDenialRiskTone, string>;

/**
 * Why a policy blocked a call, under its tool line. The heading names the policy and holds the
 * Allow button while the user can allow the call. The reason wraps under it at full width.
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
      className="ml-[22px] min-w-0 rounded-lg border border-warning-border/50 bg-card py-2 pr-2 pl-3 text-xs"
    >
      <div className="flex min-h-6 min-w-0 items-center gap-2">
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
        {action ? (
          <div className="ml-auto shrink-0 pl-2">
            <DeniedToolActionControl action={action} />
          </div>
        ) : null}
      </div>
      {/* The text starts under the label: the 14 px icon and the 8 px gap. */}
      {detail ? (
        <p className="max-w-[72ch] whitespace-pre-wrap pl-[22px] leading-[18px] text-muted-foreground [overflow-wrap:anywhere]">
          {detail}
        </p>
      ) : null}
      {action?.failure ? (
        <p
          role="alert"
          className="mt-1 pl-[22px] leading-5 text-destructive-muted [overflow-wrap:anywhere]"
        >
          {action.failure}
        </p>
      ) : null}
    </section>
  );
};

/** The Allow button and its progress, or the label that says the user allowed the call. */
const DeniedToolActionControl = ({ action }: { action: DeniedToolAction }): ReactElement => {
  if (action.state === "allowed") {
    return (
      <span
        title={TOOL_DENIAL_ALLOWED_MESSAGE}
        className="inline-flex h-6 items-center gap-1 font-medium text-success-muted"
      >
        <Check aria-hidden="true" className="size-3.5" />
        {TOOL_DENIAL_ALLOWED_LABEL}
      </span>
    );
  }
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="font-medium"
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
        </TooltipTrigger>
        <TooltipContent side="top">{TOOL_DENIAL_ALLOW_HINT}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
};
