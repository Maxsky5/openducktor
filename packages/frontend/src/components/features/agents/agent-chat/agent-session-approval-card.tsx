import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { CircleSlash2, ShieldAlert } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import type { AgentApprovalRequest } from "@/types/agent-orchestrator";
import { resolveApprovalReplyOutcomes } from "./agent-session-approval-card-model";

const APPROVAL_OUTCOME_LABELS: Partial<Record<RuntimeApprovalReplyOutcome, string>> = {
  approve_once: "Approve once",
  approve_turn: "Approve for turn",
  approve_session: "Approve for session",
  approve_always: "Always allow",
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

const AFFECTED_PATH_CODE_CLASS_NAME =
  "rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[0.85em] text-foreground";

const formatToolInput = (input: Record<string, unknown>): string => JSON.stringify(input, null, 2);

type AgentSessionApprovalCardProps = {
  request: AgentApprovalRequest;
  runtimeSupportedReplyOutcomes: readonly RuntimeApprovalReplyOutcome[] | null;
  disabled?: boolean;
  isSubmitting?: boolean;
  errorMessage?: string | undefined;
  onReply: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
};

export function AgentSessionApprovalCard({
  request,
  runtimeSupportedReplyOutcomes,
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

  const supportedOutcomes = resolveApprovalReplyOutcomes({
    requestSupportedReplyOutcomes: request.supportedReplyOutcomes,
    runtimeSupportedReplyOutcomes,
  });
  const canReply = supportedOutcomes.length > 0;
  const missingCapabilityMessage = runtimeSupportedReplyOutcomes
    ? "This runtime does not support any declared approval outcomes for this request."
    : "Runtime approval capabilities are unavailable for this request. Refresh runtime checks or open the session again, then try again.";
  const sourceLabel = request.source?.kind === "subagent" ? "Subagent request" : null;
  const toolInputText =
    request.tool?.input && !request.command ? formatToolInput(request.tool.input) : null;

  return (
    <section className="rounded-xl border border-warning-border bg-warning-surface shadow-sm">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-warning-border px-3 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          <ShieldAlert className="size-4 text-warning-muted" />
          <p className="text-[13px] font-semibold text-foreground">Approval required</p>
          {sourceLabel ? (
            <span className="rounded-full border border-warning-border bg-background px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
              {sourceLabel}
            </span>
          ) : null}
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
            <div className="space-y-1">
              <p className="text-xs text-foreground">Affected paths:</p>
              <div className="max-h-24 overflow-auto rounded-md border border-border bg-muted p-2">
                <ul className="space-y-1">
                  {request.affectedPaths.map((path) => (
                    <li key={path}>
                      <code className={AFFECTED_PATH_CODE_CLASS_NAME}>{path}</code>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
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
          {toolInputText ? (
            <div className="space-y-1">
              <p className="text-xs text-foreground">Tool input:</p>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-2 font-mono text-[11px] leading-relaxed text-foreground">
                {toolInputText}
              </pre>
            </div>
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
            {missingCapabilityMessage}
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
            Submitting approval choice…
          </p>
        ) : null}
      </div>
    </section>
  );
}
