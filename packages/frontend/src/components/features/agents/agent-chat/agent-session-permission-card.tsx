import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { CircleSlash2, ShieldAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import type { AgentApprovalRequest } from "@/types/agent-orchestrator";

const APPROVAL_OUTCOME_LABELS: Partial<Record<RuntimeApprovalReplyOutcome, string>> = {
  approve_once: "Approve once",
  approve_turn: "Approve for turn",
  approve_session: "Approve for session",
  reject: "Reject",
};

const getApprovalOutcomeButtonVariant = (
  outcome: RuntimeApprovalReplyOutcome,
): "default" | "outline" | "destructive" => {
  if (outcome === "reject") {
    return "destructive";
  }
  if (outcome === "approve_once") {
    return "default";
  }
  return "outline";
};

type AgentSessionApprovalCardProps = {
  request: AgentApprovalRequest;
  disabled?: boolean;
  isSubmitting?: boolean;
  errorMessage?: string | undefined;
  onReply: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
};

export function AgentSessionApprovalCard({
  request,
  disabled = false,
  isSubmitting = false,
  errorMessage,
  onReply,
}: AgentSessionApprovalCardProps): ReactElement | null {
  const hasDisplayContent = Boolean(
    request.title ||
      request.summary ||
      request.details ||
      request.command ||
      request.action ||
      request.tool ||
      request.affectedPaths?.length,
  );
  if (!hasDisplayContent) {
    return null;
  }

  const supportedOutcomes = request.supportedReplyOutcomes ?? [];
  const canReply = supportedOutcomes.length > 0;

  return (
    <section className="rounded-xl border border-warning-border bg-warning-surface shadow-sm">
      <header className="flex items-center justify-between gap-2 border-b border-warning-border px-3 py-1.5">
        <div className="flex items-center gap-2">
          <ShieldAlert className="size-4 text-warning-muted" />
          <p className="text-[13px] font-semibold text-foreground">Approval required</p>
        </div>
        <p className="text-[11px] font-medium text-muted-foreground">Action required</p>
      </header>

      <div className="space-y-2 p-2.5">
        <div className="space-y-1">
          {request.title ? (
            <p className="text-sm font-medium text-foreground">{request.title}</p>
          ) : null}
          {request.summary ? <p className="text-xs text-foreground">{request.summary}</p> : null}
          {request.details ? (
            <p className="text-xs text-muted-foreground">{request.details}</p>
          ) : null}
          {request.affectedPaths?.length ? (
            <p className="text-xs text-foreground">
              Affected paths: {request.affectedPaths.join(", ")}
            </p>
          ) : null}
          {request.command ? (
            <p className="text-xs text-foreground">Command: {request.command.command}</p>
          ) : null}
          {request.action ? (
            <p className="text-xs text-foreground">Action: {request.action.name}</p>
          ) : null}
          {request.tool ? (
            <p className="text-xs text-foreground">Tool: {request.tool.name}</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2 pt-1">
          {supportedOutcomes.map((outcome) => (
            <Button
              key={outcome}
              type="button"
              size="sm"
              variant={getApprovalOutcomeButtonVariant(outcome)}
              disabled={disabled || isSubmitting}
              onClick={() => {
                void onReply(request.requestId, outcome);
              }}
            >
              {APPROVAL_OUTCOME_LABELS[outcome] ?? outcome}
            </Button>
          ))}
        </div>

        {!canReply ? (
          <p className="rounded-md border border-warning-border bg-warning-surface px-2 py-1 text-xs text-warning-muted">
            This runtime did not declare supported approval outcomes for this request.
          </p>
        ) : null}

        {errorMessage ? (
          <p className="rounded-md border border-destructive-border bg-destructive-surface px-2 py-1 text-xs text-destructive-muted">
            {errorMessage}
          </p>
        ) : null}

        {isSubmitting ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CircleSlash2 className="size-3" />
            Submitting approval choice...
          </p>
        ) : null}
      </div>
    </section>
  );
}
