import type { AgentToolDenial } from "@openducktor/contracts";
import {
  readToolDenialPresentation,
  TOOL_DENIAL_ALLOWED_MESSAGE,
} from "@openducktor/frontend-core/sessions/messages/tool-denial";
import { useDeniedToolAction } from "@openducktor/frontend-core/sessions/messages/use-denied-tool-action";
import { Check, LoaderCircle, ShieldAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

/**
 * Why a policy blocked a call, under its tool line. A call that the user can allow has an Allow
 * button until the user allows it. The reason wraps, so the reader always sees all of it.
 */
export const ToolDenialNotice = ({
  callId,
  denial,
}: {
  callId: string;
  denial: AgentToolDenial;
}): ReactElement => {
  const { label, reason, riskLabel } = readToolDenialPresentation(denial);
  return (
    <Alert
      variant="warning"
      role="note"
      data-slot="tool-denial"
      className="ml-[22px] min-w-0 flex-col gap-1.5 rounded-md px-2.5 py-2 text-xs"
    >
      <AlertTitle className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 leading-normal text-warning-muted">
        <ShieldAlert aria-hidden="true" className="size-3.5 shrink-0 text-warning-accent" />
        <span>{label}</span>
        {riskLabel ? (
          <span className="rounded border border-warning-border px-1 py-px text-[11px] leading-4">
            {riskLabel}
          </span>
        ) : null}
      </AlertTitle>
      {reason ? (
        <AlertDescription className="whitespace-pre-wrap text-xs [overflow-wrap:anywhere]">
          {reason}
        </AlertDescription>
      ) : null}
      <DeniedToolActionControl callId={callId} />
    </Alert>
  );
};

/** The Allow button, its progress, or the note that the user allowed the call. */
const DeniedToolActionControl = ({ callId }: { callId: string }): ReactElement | null => {
  const action = useDeniedToolAction(callId);
  if (!action) return null;
  const failure = action.failure ? (
    <p role="alert" className="leading-5 text-destructive-muted [overflow-wrap:anywhere]">
      {action.failure}
    </p>
  ) : null;
  if (action.state === "allowed") {
    return (
      <>
        <p className="flex items-center gap-1.5 leading-5 text-success-muted">
          <Check aria-hidden="true" className="size-3.5 shrink-0" />
          {TOOL_DENIAL_ALLOWED_MESSAGE}
        </p>
        {failure}
      </>
    );
  }
  return (
    <>
      <div>
        <Button
          type="button"
          variant="outline"
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
      </div>
      {failure}
    </>
  );
};
