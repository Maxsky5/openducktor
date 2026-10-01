import type {
  AgentSessionLiveReplyApprovalInput,
  AgentSessionLiveReplyQuestionInput,
  RuntimeDescriptor,
} from "@openducktor/contracts";
import { useCallback, useState, type ReactElement } from "react";
import { AgentSessionApprovalCard } from "@/components/features/agents/agent-chat/agent-session-approval-card";
import { AgentSessionQuestionCard } from "@/components/features/agents/agent-chat/agent-session-question-card";
import { useRuntimeTranscriptInteractions } from "@/components/features/agents/agent-chat/readonly-transcript/use-runtime-transcript-interactions";
import type { SessionPreviewPendingInput } from "@/features/session-navigation/session-preview-model";
import { agentSessionIdentityKey } from "@/lib/agent-session-identity";
import { pendingInputIdentity } from "@/lib/pending-input-identity";
import { useRequiredContext } from "@/state/app-state-contexts";
import { host } from "@/state/operations/host";
import { WorkspaceActivityContext } from "@/state/workspace-activity/workspace-activity-context";
import type { AgentOperationsContextValue } from "@/types/state-slices";

/** Reuse the chat's forms and reply state, with the request's own workspace and child identity. */
export function SessionPreviewPendingRequests({
  input,
  workspaceId,
  runtimeDefinitions,
}: {
  input: SessionPreviewPendingInput;
  workspaceId: string;
  runtimeDefinitions: RuntimeDescriptor[];
}): ReactElement {
  const observer = useRequiredContext(WorkspaceActivityContext, "SessionPreviewPendingRequests");
  const [sent, setSent] = useState<ReadonlySet<string>>(() => new Set());
  const requireCurrentRequest = useCallback(
    (
      request:
        | Parameters<AgentOperationsContextValue["answerAgentQuestion"]>[1]
        | Parameters<AgentOperationsContextValue["replyAgentApproval"]>[1],
      kind: "question" | "approval",
    ) => {
      const projection = observer.getWorkspaceProjection(workspaceId);
      const key = agentSessionIdentityKey(input.ref);
      const session = projection?.sessions.get(key);
      const fault = projection?.faults.get(key);
      const failure =
        projection?.unavailableReason ??
        session?.statusUnavailableReason ??
        (fault?.statusUnavailable ? fault.message : null);
      if (failure) throw new Error(failure);
      const requests =
        kind === "question"
          ? session?.preview?.pendingQuestions
          : session?.preview?.pendingApprovals;
      if (
        !projection?.hasSnapshot ||
        !requests?.some(
          (current) =>
            current.requestId === request.requestId &&
            pendingInputIdentity(current) === pendingInputIdentity(request),
        )
      ) {
        throw new Error("This request is no longer pending. Check the current session preview.");
      }
    },
    [input.ref, observer, workspaceId],
  );
  const replyAgentApproval = useCallback<AgentOperationsContextValue["replyAgentApproval"]>(
    async (_identity, request, outcome, message) => {
      requireCurrentRequest(request, "approval");
      const reply: AgentSessionLiveReplyApprovalInput = {
        ...input.ref,
        requestId: request.requestId,
        outcome,
      };
      if (message !== undefined) reply.message = message;
      await host.agentSessionLiveReplyApproval(reply);
      setSent((current) => new Set([...current, `approval:${pendingInputIdentity(request)}`]));
    },
    [input.ref, requireCurrentRequest],
  );
  const answerAgentQuestion = useCallback<AgentOperationsContextValue["answerAgentQuestion"]>(
    async (_identity, request, answers) => {
      requireCurrentRequest(request, "question");
      const reply: AgentSessionLiveReplyQuestionInput = {
        ...input.ref,
        requestId: request.requestId,
        answers,
        sessionScope: input.scope,
      };
      if (request.blocking !== undefined) reply.blocking = request.blocking;
      await host.agentSessionLiveReplyQuestion(reply);
      setSent((current) => new Set([...current, `question:${pendingInputIdentity(request)}`]));
    },
    [input.ref, input.scope, requireCurrentRequest],
  );
  const definition = runtimeDefinitions.find((runtime) => runtime.kind === input.ref.runtimeKind);
  const interactions = useRuntimeTranscriptInteractions({
    target: input.ref,
    hasLiveSession: true,
    pendingApprovalRequests: input.approvals,
    pendingQuestionRequests: input.questions,
    isRuntimeReady: input.unavailableReason === null && definition !== undefined,
    replyAgentApproval,
    answerAgentQuestion,
    sessionScope: input.scope,
  });
  return (
    <div className="space-y-3">
      {input.unavailableReason ? (
        <p role="alert" className="text-xs text-warning-muted">
          {input.unavailableReason}
        </p>
      ) : null}
      {input.approvals.map((request) =>
        sent.has(`approval:${pendingInputIdentity(request)}`) ? (
          <p
            key={pendingInputIdentity(request)}
            role="status"
            className="rounded-md border border-success-border bg-success-surface p-2.5 text-xs text-success-muted"
          >
            Permission reply sent.
          </p>
        ) : (
          <AgentSessionApprovalCard
            key={pendingInputIdentity(request)}
            request={request}
            runtimeSupportedReplyOutcomes={
              definition?.capabilities.approvals.supportedReplyOutcomes ?? null
            }
            disabled={!interactions.approvals.canReply}
            isSubmitting={
              interactions.approvals.isSubmittingByRequestId[request.requestId] ?? false
            }
            errorMessage={interactions.approvals.errorByRequestId[request.requestId]}
            onReply={interactions.approvals.onReply}
          />
        ),
      )}
      {input.questions.map((request) =>
        sent.has(`question:${pendingInputIdentity(request)}`) ? (
          <p
            key={pendingInputIdentity(request)}
            role="status"
            className="rounded-md border border-success-border bg-success-surface p-2.5 text-xs text-success-muted"
          >
            Answer sent.
          </p>
        ) : (
          <AgentSessionQuestionCard
            key={pendingInputIdentity(request)}
            request={request}
            disabled={
              !interactions.pendingQuestions.canSubmit ||
              !definition?.capabilities.structuredInput.supportsQuestionResolution
            }
            isSubmitting={
              interactions.pendingQuestions.isSubmittingByRequestId[request.requestId] ?? false
            }
            onSubmit={interactions.pendingQuestions.onSubmit}
          />
        ),
      )}
    </div>
  );
}
