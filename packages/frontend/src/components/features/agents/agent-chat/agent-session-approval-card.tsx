import { buildContentEntries } from "@openducktor/frontend-core/sessions/transcript/agent-chat-content-keys";
import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { CircleSlash2 } from "lucide-react";
import type { ReactElement } from "react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import type { AgentApprovalRequest } from "@openducktor/frontend-core/types/agent-orchestrator";
import { pendingInputIdentity } from "@openducktor/frontend-core/lib/pending-input-identity";
import {
  approvalCapabilityWarning,
  approvalOutcomeEmphasis,
  approvalOutcomeLabel,
  approvalRequestDescription,
  approvalToolInputText,
  hasApprovalRequestContent,
  resolveApprovalReplyOutcomes,
} from "@openducktor/frontend-core/sessions/pending-input/agent-session-approval-card-model";
import { PENDING_INPUT_LABELS } from "@openducktor/frontend-core/sessions/pending-input/pending-input-labels";
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
  if (!hasApprovalRequestContent(request)) {
    return null;
  }

  const supportedOutcomes = resolveApprovalReplyOutcomes({
    requestSupportedReplyOutcomes: request.supportedReplyOutcomes,
    runtimeSupportedReplyOutcomes,
  });
  const capabilityWarning = approvalCapabilityWarning({
    supportedOutcomes,
    runtimeSupportedReplyOutcomes,
  });
  const description = approvalRequestDescription(request);

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
          status={PENDING_INPUT_LABELS.permissionStatus}
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
                {approvalOutcomeLabel(outcome, request)}
              </Button>
            ))}
          </div>
        </CollapsibleContent>

        <ApprovalFeedback
          capabilityWarning={capabilityWarning}
          errorMessage={errorMessage}
          isSubmitting={isSubmitting}
        />
      </section>
    </Collapsible>
  );
}

const OUTCOME_BUTTON_VARIANTS = {
  primary: "default",
  secondary: "outline",
  destructive: "destructive",
} as const;

const getOutcomeVariant = (
  outcome: RuntimeApprovalReplyOutcome,
): "default" | "outline" | "destructive" =>
  OUTCOME_BUTTON_VARIANTS[approvalOutcomeEmphasis(outcome)];

const PATH_CLASS_NAME =
  "rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[0.85em] text-foreground";

function ApprovalDetails({ request }: { request: AgentApprovalRequest }): ReactElement {
  const grantEntries = buildContentEntries(request.persistentGrant?.rules ?? [], (rule) =>
    JSON.stringify([rule.action, rule.resource]),
  );
  const toolInputText = approvalToolInputText(request);

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
          {PENDING_INPUT_LABELS.submittingApproval}
        </p>
      ) : null}
    </div>
  ) : null;
}
