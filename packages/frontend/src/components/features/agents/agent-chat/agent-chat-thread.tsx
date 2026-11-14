import { AgentChatForkActionsContext } from "./agent-chat-fork-context";
import type { ToolPartSession } from "@openducktor/frontend-core/queries/agent-session-tool-part";
import { ToolPartSessionContext } from "@openducktor/frontend-core/sessions/messages/use-tool-part-details";
import { AgentChatImageSessionContext } from "./agent-chat-image-session-context";
import type { AgentSessionLiveRef } from "@openducktor/contracts";
import type { AgentSessionTodoItem } from "@openducktor/core";
import { AlertTriangle, Info, LoaderCircle, RefreshCcw, Sparkles } from "lucide-react";
import {
  memo,
  type ReactElement,
  type RefObject,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { agentSessionIdentityKey } from "@openducktor/frontend-core/lib/agent-session-identity";
import { pendingInputIdentity } from "@openducktor/frontend-core/lib/pending-input-identity";
import { AgentChatInterruptedTurnResume } from "./agent-chat-interrupted-turn-resume";
import type { AgentChatThreadModel } from "./agent-chat.types";
import type { AgentChatUserMessageAnchor } from "@openducktor/frontend-core/sessions/transcript/agent-chat-transcript-model";
import { useAgentChatSettings } from "./agent-chat-settings-context";
import { AgentChatTurnGroup } from "./agent-chat-turn-group";
import { AgentChatToolDetailsBeside } from "./agent-chat-tool-details-panel";
import {
  createToolDetailsStore,
  type ToolCallSource,
  ToolCallSourceContext,
  type ToolCallSourceContextValue,
  type ToolDetailsStore,
  ToolDetailsStoreContext,
} from "./agent-chat-tool-details-store";
import { createToolRunFoldStore, ToolRunActionsContext } from "./agent-chat-tool-run-folds";
import { AgentSessionApprovalCard } from "./agent-session-approval-card";
import { AgentSessionQuestionCard } from "./agent-session-question-card";
import { buildQuestionCardKey } from "@openducktor/frontend-core/sessions/pending-input/agent-session-question-keys";
import { MINIMAP_GUTTER_PX } from "./conversation-minimap/constants";
import { ConversationMinimap } from "./conversation-minimap/conversation-minimap";
import { useMinimapRailHeight } from "./conversation-minimap/use-minimap-rail-height";
import { AgentSessionTodoPanel } from "./agent-session-todo-panel";
import {
  getActionableSessionTodo,
  getVisibleSessionTodos,
} from "@openducktor/frontend-core/sessions/session-view/agent-session-todo-panel-model";
import type { AgentSessionTranscriptTarget } from "@openducktor/frontend-core/sessions/transcript/agent-session-transcript-target";
import { ScrollToBottomButton } from "./scroll-to-bottom-button";
import { ScrollToTopButton } from "./scroll-to-top-button";
import {
  type AgentChatRenderedTurn,
  useAgentChatRenderedTranscript,
} from "./use-agent-chat-rendered-transcript";
import type { AgentChatTranscriptNavigation } from "./use-agent-chat-transcript-navigation";

export function AgentChatThread({
  model,
  visitKey = 0,
}: {
  model: AgentChatThreadModel;
  visitKey?: number | string;
}): ReactElement {
  const {
    transcript,
    runtimePresentation,
    isInteractionEnabled,
    emptyState,
    modelCatalog,
    isStarting,
    isSending,
    pendingApprovalRequests,
    pendingQuestionRequests,
    subagentPendingApprovalCountBySessionKey,
    subagentPendingQuestionCountBySessionKey,
    todos,
    sessionAccentColor,
    canSubmitQuestionAnswers,
    isSubmittingQuestionByRequestId,
    onSubmitQuestionAnswers,
    canReplyToApprovals,
    isSubmittingApprovalByRequestId,
    approvalReplyErrorByRequestId,
    onReplyApproval,
    interruptedTurnResume,
    sessionAuxiliaryError,
    isSessionWorking,
    todoPanelCollapsed,
    onToggleTodoPanel,
    messagesContainerRef,
    scrollToBottomOnSendRef,
  } = model;
  const { session, target: transcriptTarget } = transcript;
  const sessionKey = JSON.stringify([
    transcript.repoPath,
    session ? agentSessionIdentityKey(session) : null,
  ]);
  const collapseResetKey = JSON.stringify([sessionKey, visitKey]);
  const { imageSessionRef, toolPartSession, toolDetails, ownToolDetails, toolCallSourceContext } =
    useTranscriptToolCalls({ transcript, sessionKey, runtimePresentation });
  const [toolRunFolds] = useState(createToolRunFoldStore);
  const {
    messagesContentRef,
    renderedTurns,
    transcriptNotice: renderedTranscriptNotice,
    isNearBottom,
    isNearTop,
    scrollToBottom,
    scrollToTop,
    toolRunActions,
    userMessageAnchors,
    navigation,
  } = useAgentChatRenderedTranscript({
    transcript,
    runtimePresentation,
    messagesContainerRef,
    scrollToBottomOnSendRef,
    toolRunFolds,
  });

  const hasVisibleTodo = getActionableSessionTodo(getVisibleSessionTodos(todos)) !== null;
  const hasWaitingInput = pendingQuestionRequests.length > 0 || pendingApprovalRequests.length > 0;
  const runtimeStatusMessage = isSessionWorking && session ? session.runtimeStatusMessage : null;
  const transcriptEmptyState = session === null ? emptyState : null;
  const hasBottomStack = resolveHasBottomStack({
    hasSession: Boolean(session),
    hasWaitingInput,
    hasVisibleTodo,
    sessionAuxiliaryError,
    runtimeStatusMessage,
    hasInterruptedTurnResume: interruptedTurnResume !== undefined,
  });

  return (
    <AgentChatForkActionsContext.Provider value={model.forkActions ?? null}>
      <AgentChatImageSessionContext.Provider value={imageSessionRef}>
        <ToolPartSessionContext value={toolPartSession}>
          <ToolDetailsStoreContext value={toolDetails}>
            <ToolCallSourceContext value={toolCallSourceContext}>
              <ToolRunActionsContext value={toolRunActions}>
                <div className="relative flex min-h-0 flex-1 flex-col">
                  {/* Details beside the transcript take the width of its rows, not of its bottom cards. */}
                  <div className="flex min-h-0 flex-1">
                    <div className="@container/transcript relative flex min-h-0 min-w-0 flex-1 flex-col">
                      <AgentChatTranscript
                        emptyState={transcriptEmptyState}
                        modelCatalog={modelCatalog}
                        isStarting={isStarting}
                        isSending={isSending}
                        isInteractionEnabled={isInteractionEnabled}
                        subagentPendingApprovalCountBySessionKey={
                          subagentPendingApprovalCountBySessionKey
                        }
                        subagentPendingQuestionCountBySessionKey={
                          subagentPendingQuestionCountBySessionKey
                        }
                        transcriptTarget={transcriptTarget}
                        runtimePresentation={runtimePresentation}
                        messagesContainerRef={messagesContainerRef}
                        messagesContentRef={messagesContentRef}
                        renderedTurns={renderedTurns}
                        transcriptNotice={renderedTranscriptNotice}
                        userMessageAnchors={userMessageAnchors}
                        navigation={navigation}
                      />
                    </div>
                    {ownToolDetails ? <AgentChatToolDetailsBeside store={ownToolDetails} /> : null}
                  </div>

                  {hasBottomStack ? (
                    <div className="min-h-0 overflow-y-auto">
                      <AgentChatBottomStack
                        sessionKey={sessionKey}
                        collapseResetKey={collapseResetKey}
                        interruptedTurnResume={interruptedTurnResume}
                        resumeDisabled={!isInteractionEnabled || isSending || isStarting}
                        pendingQuestions={pendingQuestionRequests}
                        pendingApprovals={pendingApprovalRequests}
                        todos={todos}
                        canSubmitQuestionAnswers={canSubmitQuestionAnswers}
                        isSubmittingQuestionByRequestId={isSubmittingQuestionByRequestId}
                        onSubmitQuestionAnswers={onSubmitQuestionAnswers}
                        canReplyToApprovals={canReplyToApprovals}
                        runtimeSupportedApprovalReplyOutcomes={
                          runtimePresentation.supportedApprovalReplyOutcomes
                        }
                        isSubmittingApprovalByRequestId={isSubmittingApprovalByRequestId}
                        approvalReplyErrorByRequestId={approvalReplyErrorByRequestId}
                        onReplyApproval={onReplyApproval}
                        sessionAuxiliaryError={sessionAuxiliaryError}
                        runtimeStatusMessage={runtimeStatusMessage}
                        todoPanelCollapsed={todoPanelCollapsed}
                        isSessionWorking={isSessionWorking}
                        sessionAccentColor={sessionAccentColor}
                        onToggleTodoPanel={onToggleTodoPanel}
                      />
                    </div>
                  ) : null}
                  {session ? (
                    <ScrollToTopButton visible={!isNearTop} onClick={scrollToTop} />
                  ) : null}
                  {session ? (
                    <ScrollToBottomButton visible={!isNearBottom} onClick={scrollToBottom} />
                  ) : null}
                </div>
              </ToolRunActionsContext>
            </ToolCallSourceContext>
          </ToolDetailsStoreContext>
        </ToolPartSessionContext>
      </AgentChatImageSessionContext.Provider>
      {model.forkDialog}
    </AgentChatForkActionsContext.Provider>
  );
}

/** The session facts that the tool calls of a transcript read, and the store of their details. */
type TranscriptToolCalls = {
  imageSessionRef: AgentSessionLiveRef | null;
  toolPartSession: ToolPartSession | null;
  toolDetails: ToolDetailsStore;
  /** The store of details that the transcript shows beside itself, without session panels. */
  ownToolDetails: ToolDetailsStore | null;
  toolCallSourceContext: ToolCallSourceContextValue;
};

const useTranscriptToolCalls = ({
  transcript,
  sessionKey,
  runtimePresentation,
}: {
  transcript: AgentChatThreadModel["transcript"];
  sessionKey: string;
  runtimePresentation: AgentChatThreadModel["runtimePresentation"];
}): TranscriptToolCalls => {
  const { session, target: transcriptTarget, repoPath } = transcript;
  // A page with session panels shows the details of a call in its right panel. Elsewhere, the
  // transcript shows them beside itself.
  const pageToolDetails = useContext(ToolDetailsStoreContext);
  const [ownToolDetails] = useState(createToolDetailsStore);
  const toolDetails = pageToolDetails ?? ownToolDetails;
  const runtimeKind = session?.runtimeKind;
  const workingDirectory = session?.workingDirectory ?? null;
  const externalSessionId = session?.externalSessionId;
  const imageSessionRef = useMemo(
    () =>
      repoPath && runtimeKind && workingDirectory && externalSessionId
        ? { repoPath, runtimeKind, workingDirectory, externalSessionId }
        : null,
    [repoPath, runtimeKind, workingDirectory, externalSessionId],
  );
  const toolPartSessionScope = transcriptTarget?.sessionScope ?? null;
  const toolPartSession = useMemo<ToolPartSession | null>(
    () => (imageSessionRef ? { ...imageSessionRef, sessionScope: toolPartSessionScope } : null),
    [imageSessionRef, toolPartSessionScope],
  );
  const chatSettings = useAgentChatSettings();
  const toolCallSource = useMemo<ToolCallSource>(
    () => ({
      key: sessionKey,
      workingDirectory,
      runtimePresentation,
      toolPartSession,
      chatSettings,
    }),
    [chatSettings, runtimePresentation, sessionKey, workingDirectory, toolPartSession],
  );
  const sessionRef = useRef(session);
  const toolCallSourceContext = useMemo<ToolCallSourceContextValue>(
    () => ({ source: toolCallSource, sessionRef }),
    [toolCallSource],
  );
  // The details of a call of this transcript follow its live messages and its settings.
  useLayoutEffect(() => {
    sessionRef.current = session;
    toolDetails.syncTranscript(toolCallSource, session);
  }, [session, toolCallSource, toolDetails]);
  return {
    imageSessionRef,
    toolPartSession,
    toolDetails,
    ownToolDetails: pageToolDetails ? null : ownToolDetails,
    toolCallSourceContext,
  };
};

type AgentChatTranscriptProps = {
  emptyState: AgentChatThreadModel["emptyState"];
  modelCatalog: AgentChatThreadModel["modelCatalog"];
  isStarting: boolean;
  isSending: boolean;
  isInteractionEnabled: boolean;
  transcriptTarget: AgentSessionTranscriptTarget | null;
  subagentPendingApprovalCountBySessionKey: AgentChatThreadModel["subagentPendingApprovalCountBySessionKey"];
  subagentPendingQuestionCountBySessionKey: AgentChatThreadModel["subagentPendingQuestionCountBySessionKey"];
  messagesContainerRef: AgentChatThreadModel["messagesContainerRef"];
  messagesContentRef: RefObject<HTMLDivElement | null>;
  renderedTurns: AgentChatRenderedTurn[];
  transcriptNotice: AgentChatThreadModel["transcript"]["notice"];
  runtimePresentation: AgentChatThreadModel["runtimePresentation"];
  userMessageAnchors: AgentChatUserMessageAnchor[];
  navigation: AgentChatTranscriptNavigation;
};

const AgentChatTranscriptNotice = memo(function AgentChatTranscriptNotice({
  notice,
}: {
  notice: NonNullable<AgentChatThreadModel["transcript"]["notice"]>;
}): ReactElement {
  const isLoadingNotice = notice.severity === "loading";
  const action = notice.action;

  return (
    <div className="sticky top-0 z-20 mb-4">
      <div
        className={cn(
          "mx-auto flex max-w-3xl items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-sm backdrop-blur",
          isLoadingNotice
            ? "border-border bg-card/95 supports-[backdrop-filter]:bg-card/85"
            : "border-destructive-border bg-destructive-surface text-destructive-muted",
        )}
      >
        <div
          className={cn(
            "mt-0.5 rounded-full p-2",
            isLoadingNotice ? "bg-muted text-muted-foreground" : "text-destructive-muted",
          )}
        >
          {isLoadingNotice ? (
            <LoaderCircle className="size-4 animate-spin" />
          ) : (
            <AlertTriangle className="size-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className={cn("font-medium", isLoadingNotice ? "text-foreground" : "")}>
            {notice.title}
          </p>
          <p className={isLoadingNotice ? "text-muted-foreground" : ""}>{notice.description}</p>
          {notice.details && notice.details.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer select-none font-medium">Show details</summary>
              <dl className="mt-2 space-y-1 text-xs">
                {notice.details.map((detail) => (
                  <div key={detail.label} className="grid grid-cols-[auto_1fr] gap-2">
                    <dt className="font-medium">{detail.label}</dt>
                    <dd className="min-w-0 break-words font-mono">{detail.value}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
        </div>
        {action ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 border-destructive-border bg-card text-destructive-muted hover:bg-destructive-surface"
            disabled={action.disabled}
            onClick={action.onAction}
          >
            <RefreshCcw className={cn("size-3.5", action.isPending ? "animate-spin" : "")} />
            {action.label}
          </Button>
        ) : null}
      </div>
    </div>
  );
});

type AgentChatBottomStackProps = {
  sessionKey: string;
  collapseResetKey: string;
  interruptedTurnResume: AgentChatThreadModel["interruptedTurnResume"];
  resumeDisabled: boolean;
  pendingQuestions: AgentChatThreadModel["pendingQuestionRequests"];
  pendingApprovals: AgentChatThreadModel["pendingApprovalRequests"];
  todos: readonly AgentSessionTodoItem[];
  sessionAuxiliaryError: string | null;
  runtimeStatusMessage: string | null;
  canSubmitQuestionAnswers: boolean;
  isSubmittingQuestionByRequestId: AgentChatThreadModel["isSubmittingQuestionByRequestId"];
  onSubmitQuestionAnswers: AgentChatThreadModel["onSubmitQuestionAnswers"];
  canReplyToApprovals: boolean;
  runtimeSupportedApprovalReplyOutcomes: AgentChatThreadModel["runtimePresentation"]["supportedApprovalReplyOutcomes"];
  isSubmittingApprovalByRequestId: AgentChatThreadModel["isSubmittingApprovalByRequestId"];
  approvalReplyErrorByRequestId: AgentChatThreadModel["approvalReplyErrorByRequestId"];
  onReplyApproval: AgentChatThreadModel["onReplyApproval"];
  todoPanelCollapsed: boolean;
  isSessionWorking: boolean;
  sessionAccentColor: string | undefined;
  onToggleTodoPanel: () => void;
};

const AgentChatTranscript = memo(function AgentChatTranscript({
  emptyState,
  modelCatalog,
  isStarting,
  isSending,
  isInteractionEnabled,
  transcriptTarget,
  subagentPendingApprovalCountBySessionKey,
  subagentPendingQuestionCountBySessionKey,
  messagesContainerRef,
  messagesContentRef,
  renderedTurns,
  transcriptNotice,
  runtimePresentation,
  userMessageAnchors,
  navigation,
}: AgentChatTranscriptProps): ReactElement {
  // The frame holds the scroll container and the minimap rail, which stays outside the container.
  const [frame, setFrame] = useState<HTMLDivElement | null>(null);
  const minimapRailMaxHeight = useMinimapRailHeight(frame, userMessageAnchors.length);

  return (
    <div ref={setFrame} className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={messagesContainerRef}
        className="agent-chat-scroll-region hide-scrollbar relative min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-4"
        // The gutter keeps the resting ticks clear of the messages.
        style={minimapRailMaxHeight === null ? undefined : { paddingLeft: MINIMAP_GUTTER_PX }}
      >
        <div ref={messagesContentRef}>
          {transcriptNotice ? <AgentChatTranscriptNotice notice={transcriptNotice} /> : null}
          {!transcriptNotice && emptyState ? (
            <div className="space-y-3 rounded-lg border border-dashed border-input bg-card p-4 text-sm text-muted-foreground">
              <p>{emptyState.title}</p>
              {emptyState.actionLabel && emptyState.onAction ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={
                    !isInteractionEnabled ||
                    isStarting ||
                    isSending ||
                    emptyState.actionDisabled ||
                    emptyState.isActionPending
                  }
                  onClick={emptyState.onAction}
                >
                  {emptyState.isActionPending ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="size-3.5" />
                  )}
                  {emptyState.actionLabel}
                </Button>
              ) : null}
            </div>
          ) : null}

          <div>
            {renderedTurns.map((turn) => (
              <AgentChatTurnGroup
                key={turn.key}
                turn={turn}
                modelCatalog={modelCatalog}
                transcriptTarget={transcriptTarget}
                runtimePresentation={runtimePresentation}
                subagentPendingApprovalCountBySessionKey={subagentPendingApprovalCountBySessionKey}
                subagentPendingQuestionCountBySessionKey={subagentPendingQuestionCountBySessionKey}
              />
            ))}
          </div>
        </div>
      </div>
      {minimapRailMaxHeight !== null && frame ? (
        <ConversationMinimap
          anchors={userMessageAnchors}
          navigation={navigation}
          railMaxHeight={minimapRailMaxHeight}
          frame={frame}
        />
      ) : null}
    </div>
  );
});

const AgentChatBottomStack = memo(function AgentChatBottomStack({
  sessionKey,
  collapseResetKey,
  interruptedTurnResume,
  resumeDisabled,
  pendingQuestions,
  pendingApprovals,
  todos,
  sessionAuxiliaryError,
  runtimeStatusMessage,
  canSubmitQuestionAnswers,
  isSubmittingQuestionByRequestId,
  onSubmitQuestionAnswers,
  canReplyToApprovals,
  runtimeSupportedApprovalReplyOutcomes,
  isSubmittingApprovalByRequestId,
  approvalReplyErrorByRequestId,
  onReplyApproval,
  todoPanelCollapsed,
  isSessionWorking,
  sessionAccentColor,
  onToggleTodoPanel,
}: AgentChatBottomStackProps): ReactElement {
  const hasVisibleTodo = getActionableSessionTodo(getVisibleSessionTodos(todos)) !== null;
  const shouldAddComposerGap = !hasVisibleTodo;

  return (
    <div
      className={cn(
        "agent-chat-bottom-stack shrink-0 space-y-2 px-4 pt-3",
        shouldAddComposerGap ? "pb-3" : "pb-0",
      )}
    >
      {interruptedTurnResume ? (
        <AgentChatInterruptedTurnResume
          isPending={interruptedTurnResume.isPending}
          error={interruptedTurnResume.error}
          usageLimit={interruptedTurnResume.usageLimit}
          disabled={resumeDisabled || interruptedTurnResume.isDisabled === true}
          onResume={interruptedTurnResume.onResume}
        />
      ) : null}

      {pendingQuestions.map((request) => (
        <AgentSessionQuestionCard
          key={buildQuestionCardKey(sessionKey, request)}
          request={request}
          collapseResetKey={collapseResetKey}
          disabled={!canSubmitQuestionAnswers}
          isSubmitting={Boolean(isSubmittingQuestionByRequestId[request.requestId])}
          onSubmit={onSubmitQuestionAnswers}
        />
      ))}

      {pendingApprovals.map((request) => (
        <div
          key={JSON.stringify([sessionKey, "permission", pendingInputIdentity(request)])}
          className="relative z-30"
        >
          <AgentSessionApprovalCard
            request={request}
            collapseResetKey={collapseResetKey}
            runtimeSupportedReplyOutcomes={runtimeSupportedApprovalReplyOutcomes ?? null}
            disabled={!canReplyToApprovals}
            isSubmitting={Boolean(isSubmittingApprovalByRequestId[request.requestId])}
            errorMessage={approvalReplyErrorByRequestId[request.requestId]}
            onReply={onReplyApproval}
          />
        </div>
      ))}

      {sessionAuxiliaryError ? (
        <div
          role="alert"
          className="rounded-md border border-destructive-border bg-destructive-surface px-3 py-2 text-sm text-destructive-surface-foreground"
          data-notification-attention-kind="error"
          tabIndex={-1}
        >
          {sessionAuxiliaryError}
        </div>
      ) : null}

      {runtimeStatusMessage ? (
        <div
          role="status"
          className="flex items-start gap-2 rounded-md border border-info-border bg-info-surface px-3 py-2 text-sm text-info-surface-foreground"
        >
          <Info className="mt-0.5 size-4 shrink-0 text-info-accent" aria-hidden="true" />
          <span>{runtimeStatusMessage}</span>
        </div>
      ) : null}

      <AgentSessionTodoPanel
        todos={todos}
        collapsed={todoPanelCollapsed}
        isSessionWorking={isSessionWorking}
        accentColor={sessionAccentColor}
        onToggleCollapse={onToggleTodoPanel}
      />
    </div>
  );
});

const resolveHasBottomStack = (input: {
  hasSession: boolean;
  hasWaitingInput: boolean;
  hasVisibleTodo: boolean;
  sessionAuxiliaryError: string | null;
  runtimeStatusMessage: string | null;
  hasInterruptedTurnResume: boolean;
}): boolean =>
  input.sessionAuxiliaryError !== null ||
  (input.hasSession &&
    (input.hasWaitingInput ||
      input.hasVisibleTodo ||
      input.runtimeStatusMessage !== null ||
      input.hasInterruptedTurnResume));
