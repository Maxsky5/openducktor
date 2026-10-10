import { buildContentEntries } from "./agent-chat-content-keys";
import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { CircleSlash2 } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import type { AgentApprovalRequest } from "@/types/agent-orchestrator";
import { pendingInputIdentity } from "@/lib/pending-input-identity";
import { resolveApprovalReplyOutcomes } from "./agent-session-approval-card-model";
import { RequestCardHeader } from "./request-card-header";
import { useRequestCardCollapse } from "./use-request-card-collapse";

type AgentSessionApprovalCardProps = {
  request: AgentApprovalRequest;
  collapseResetKey?: string;
  runtimeSupportedReplyOutcomes: readonly RuntimeApprovalReplyOutcome[] | null;
  disabled?: boolean;
  isSubmitting?: boolean;
  errorMessage?: string | undefined;
  onReply: (requestId: string, outcome: RuntimeApprovalReplyOutcome) => Promise<void>;
};

export function AgentSessionApprovalCard({
  request,
  collapseResetKey = "",
  runtimeSupportedReplyOutcomes,
  disabled = false,
  isSubmitting = false,
  errorMessage,
  onReply,
}: AgentSessionApprovalCardProps): ReactElement | null {
  const { isExpanded, onExpandedChange, contentRef, triggerRef } =
    useRequestCardCollapse(collapseResetKey);
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
  const description = getDescription(request);

  return (
    <Collapsible open={isExpanded} onOpenChange={onExpandedChange} asChild>
      <section
        className="rounded-xl border border-warning-border bg-warning-surface shadow-sm"
        data-notification-attention-kind="permission"
        data-notification-attention-id={pendingInputIdentity(request)}
        tabIndex={-1}
      >
        <RequestCardHeader
          kind="permission"
          description={description}
          isSubagent={request.source?.kind === "subagent"}
          status="Action required"
          isExpanded={isExpanded}
          triggerRef={triggerRef}
        />

        <CollapsibleContent
          forceMount
          ref={contentRef}
          hidden={!isExpanded}
          style={{ display: isExpanded ? undefined : "none" }}
          className="space-y-2 border-t border-warning-border p-2.5"
        >
          <ApprovalDetails request={request} />

          <div className="flex flex-wrap gap-2 pt-1">
            {supportedOutcomes.map((outcome) => (
              <Button
                key={outcome}
                type="button"
                size="sm"
                variant={getOutcomeVariant(outcome)}
                disabled={disabled || isSubmitting}
                onClick={() => {
                  void onReply(request.requestId, outcome);
                }}
              >
                {outcome === "approve_always" && request.persistentGrant?.scope === "project"
                  ? "Allow for project"
                  : (OUTCOME_LABELS[outcome] ?? outcome)}
              </Button>
            ))}
          </div>
        </CollapsibleContent>

        <ApprovalFeedback
          capabilityWarning={canReply ? null : missingCapabilityMessage}
          errorMessage={errorMessage}
          isSubmitting={isSubmitting}
        />
      </section>
    </Collapsible>
  );
}

const OUTCOME_LABELS = {
  approve_once: "Approve once",
  approve_turn: "Approve for turn",
  approve_session: "Approve for session",
  approve_always: "Always allow",
  reject: "Reject",
} satisfies Partial<Record<RuntimeApprovalReplyOutcome, string>>;

const getOutcomeVariant = (
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

const PATH_CLASS_NAME =
  "rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[0.85em] text-foreground";

const formatToolInput = (
  input: NonNullable<NonNullable<AgentApprovalRequest["tool"]>["input"]>,
): string => JSON.stringify(input, null, 2);

function ApprovalDetails({ request }: { request: AgentApprovalRequest }): ReactElement {
  const grantEntries = buildContentEntries(request.persistentGrant?.rules ?? [], (rule) =>
    JSON.stringify([rule.action, rule.resource]),
  );
  const toolInputText =
    request.tool?.input && !request.command ? formatToolInput(request.tool.input) : null;

  return (
    <div className="space-y-1">
      {request.persistentGrant ? (
        <p className="text-xs text-foreground">
          Allow for project saves this grant for future sessions in{" "}
          <code>{request.persistentGrant.projectDirectory}</code>.
        </p>
      ) : null}
      {request.rejectsAllPendingApprovals ? (
        <p className="text-xs text-foreground">
          Reject cancels all pending approvals in this conversation.
        </p>
      ) : null}
      {request.persistentGrant?.rules ? (
        <ul className="text-xs text-muted-foreground">
          {grantEntries.map(({ value: rule, key }) => (
            <li key={key}>
              <code>
                {rule.action}: {rule.resource}
              </code>
            </li>
          ))}
        </ul>
      ) : null}
      {request.title ? (
        <p className="text-sm font-medium text-foreground">{request.title}</p>
      ) : null}
      {request.summary ? <p className="text-xs text-foreground">{request.summary}</p> : null}
      {request.details ? <p className="text-xs text-muted-foreground">{request.details}</p> : null}
      {request.affectedPaths?.length ? (
        <div className="space-y-1">
          <p className="text-xs text-foreground">Affected paths:</p>
          <div className="max-h-24 overflow-auto rounded-md border border-border bg-muted p-2">
            <ul className="space-y-1">
              {request.affectedPaths.map((path) => (
                <li key={path}>
                  <code className={PATH_CLASS_NAME}>{path}</code>
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
      {request.tool ? <p className="text-xs text-foreground">Tool: {request.tool.name}</p> : null}
      {toolInputText ? (
        <div className="space-y-1">
          <p className="text-xs text-foreground">Tool input:</p>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-muted p-2 font-mono text-[11px] leading-relaxed text-foreground">
            {toolInputText}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

function ApprovalFeedback({
  capabilityWarning,
  errorMessage,
  isSubmitting,
}: {
  capabilityWarning: string | null;
  errorMessage: string | undefined;
  isSubmitting: boolean;
}): ReactElement | null {
  return capabilityWarning || errorMessage || isSubmitting ? (
    <div className="space-y-2 px-2.5 pb-2.5">
      {capabilityWarning ? (
        <p className="rounded-md border border-warning-border bg-warning-surface px-2 py-1 text-xs text-warning-muted">
          {capabilityWarning}
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
  ) : null;
}

function getDescription(request: AgentApprovalRequest): string | undefined {
  return [
    request.title,
    request.summary,
    request.command?.command,
    request.action?.name,
    request.tool?.name,
    request.details,
    request.affectedPaths?.[0],
  ].find((value) => value?.trim());
}
