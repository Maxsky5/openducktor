import type { RuntimeApprovalReplyOutcome } from "@openducktor/contracts";
import { useRuntimeAvailabilityContext } from "@openducktor/frontend-core/app-state/app-state-contexts";
import { pendingInputIdentity } from "@openducktor/frontend-core/lib/pending-input-identity";
import { buildQuestionCardKey } from "@openducktor/frontend-core/sessions/pending-input/agent-session-question-keys";
import { useAgentSessionApprovalActions } from "@openducktor/frontend-core/sessions/pending-input/use-agent-session-approval-actions";
import { useAgentSessionQuestionActions } from "@openducktor/frontend-core/sessions/pending-input/use-agent-session-question-actions";
import { resolveAgentChatRuntimePresentation } from "@openducktor/frontend-core/sessions/send/agent-chat-runtime-presentation";
import { useAgentOperationsContext } from "@openducktor/frontend-core/sessions/session-contexts";
import { useAgentSessionVisiblePendingInput } from "@openducktor/frontend-core/sessions/session-store-hooks";
import type {
  AgentApprovalRequest,
  AgentSessionIdentity,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import {
  type ComponentRef,
  type ReactElement,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { AccessibilityInfo, type ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useCommandGate } from "@/host-session/active-session-context";
import { useSessionScreen, useSessionTarget } from "../session-target";
import { PermissionPromptCard } from "./permission-prompt-card";
import { StructuredQuestionCard } from "./structured-question-card";
import { useReplyFailures } from "./use-reply-failures";

type PendingInputProps = {
  focus: boolean;
  scrollRef: RefObject<ComponentRef<typeof ScrollView> | null>;
};

/**
 * The Structured Questions and Permission Prompts of the session, as raised cards above the
 * composer, including Subagent Pending Input that the parent shows. Each request stays until the
 * host confirms the reply. `focus` brings the first request into view and moves the screen
 * reader to it.
 */
export function SessionPendingInput({ focus, scrollRef }: PendingInputProps): ReactElement | null {
  const target = useSessionTarget();
  if (target.readOnly) return null;
  return <PendingInputList focus={focus} scrollRef={scrollRef} />;
}

function PendingInputList({ focus, scrollRef }: PendingInputProps): ReactElement | null {
  const { target, interaction } = useSessionScreen();
  const { identity, sessionKey, sessionScope } = target;
  const { pendingApprovals, pendingQuestions } = useAgentSessionVisiblePendingInput(identity);
  const { replyAgentApproval, answerAgentQuestion } = useAgentOperationsContext();
  const { allRuntimeDefinitions } = useRuntimeAvailabilityContext();
  const gate = useCommandGate();
  const canReply = interaction.canInteract && gate.open;
  const blockedReason = canReply ? null : interaction.blockedReason;

  const runtimeSupportedReplyOutcomes = useMemo(
    () =>
      resolveAgentChatRuntimePresentation({
        runtimeDefinitions: allRuntimeDefinitions,
        runtimeKind: identity.runtimeKind,
      }).supportedApprovalReplyOutcomes,
    [allRuntimeDefinitions, identity.runtimeKind],
  );

  const approvalIds = useMemo(
    () => pendingApprovals.map((request) => request.requestId),
    [pendingApprovals],
  );
  const failures = useReplyFailures(approvalIds);
  const { record, clear } = failures;
  const replyWithOutcome = useCallback(
    async (
      session: AgentSessionIdentity,
      request: AgentApprovalRequest,
      outcome: RuntimeApprovalReplyOutcome,
      message?: string,
    ): Promise<void> => {
      clear(request.requestId);
      try {
        await replyAgentApproval(session, request, outcome, message);
      } catch (cause) {
        record(request.requestId, cause, "Reply not sent");
        throw cause;
      }
    },
    [clear, record, replyAgentApproval],
  );
  const approvals = useAgentSessionApprovalActions({
    sessionIdentity: identity,
    pendingApprovals,
    canReplyToApprovals: canReply,
    replyAgentApproval: replyWithOutcome,
  });
  const questions = useAgentSessionQuestionActions({
    sessionIdentity: identity,
    pendingQuestions,
    canAnswerQuestions: canReply,
    answerAgentQuestion,
    sessionScope,
  });
  const { onReplyApproval } = approvals;
  const reply = useCallback(
    (requestId: string, outcome: RuntimeApprovalReplyOutcome) => {
      void onReplyApproval(requestId, outcome);
    },
    [onReplyApproval],
  );

  const firstCardRef = useRef<ComponentRef<typeof View>>(null);
  const firstRequest = pendingQuestions[0] ?? pendingApprovals[0] ?? null;
  const firstRequestKey = firstRequest ? pendingInputIdentity(firstRequest) : null;
  const focusedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || firstRequestKey === null || focusedKey.current === firstRequestKey) return;
    focusedKey.current = firstRequestKey;
    const card = firstCardRef.current;
    const scroll = scrollRef.current;
    const content = scroll?.getInnerViewRef();
    if (card && scroll && content) {
      card.measureLayout(content, (_x, y) => scroll.scrollTo({ y, animated: false }));
      AccessibilityInfo.sendAccessibilityEvent(card, "focus");
    }
  }, [firstRequestKey, focus, scrollRef]);

  if (!firstRequest) return null;
  const firstIsQuestion = pendingQuestions.length > 0;

  return (
    <View style={styles.content} accessibilityLabel="Pending input">
      {/* A session has few pending requests, and each card keeps the answers that the user typed. */}
      {pendingQuestions.map((request, index) => (
        <StructuredQuestionCard
          key={buildQuestionCardKey(sessionKey, request)}
          request={request}
          disabled={!canReply}
          blockedReason={blockedReason}
          isSubmitting={Boolean(questions.isSubmittingQuestionByRequestId[request.requestId])}
          onSubmit={questions.onSubmitQuestionAnswers}
          cardRef={index === 0 ? firstCardRef : undefined}
        />
      ))}
      {pendingApprovals.map((request, index) => (
        <PermissionPromptCard
          key={JSON.stringify([sessionKey, "permission", pendingInputIdentity(request)])}
          request={request}
          runtimeSupportedReplyOutcomes={runtimeSupportedReplyOutcomes}
          disabled={!canReply}
          blockedReason={blockedReason}
          isSubmitting={Boolean(approvals.isSubmittingApprovalByRequestId[request.requestId])}
          failure={failures.byRequestId.get(request.requestId) ?? null}
          onReply={reply}
          cardRef={index === 0 && !firstIsQuestion ? firstCardRef : undefined}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The side and bottom space lets the raised cards show their shadow.
  content: {
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.xs,
  },
}));
