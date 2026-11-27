import { type AgentMessageSubmitMode, RUNTIME_DESCRIPTORS_BY_KIND } from "@openducktor/contracts";
import { draftHasMeaningfulContent } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import type { QueuedMessageSteerContext } from "@openducktor/frontend-core/sessions/send/agent-chat-steering";
import type {
  AgentSessionContextUsage,
  AgentSessionState,
} from "@openducktor/frontend-core/types/agent-orchestrator";
import { useRouter } from "expo-router";
import { memo, type ReactElement, useCallback, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { RuntimeHandoffIndicator } from "@/features/session/runtime-handoff-indicator";
import { useSessionSelector } from "@/features/session/use-session-selector";
import { routes } from "@/navigation/routes";
import { useAppTheme } from "@/theme/app-theme-context";
import { runtimeAccentColor } from "@/theme/runtime-accent";
import { touchSlop } from "@/theme/tokens";
import { BorderRay } from "@/ui/border-ray";
import { RuntimeIcon } from "@/ui/brand-icons";
import { haptics } from "@/ui/haptics";
import { blurFocusedField } from "@/ui/keyboard-dismiss";
import { useBottomEdgePadding } from "@/ui/keyboard-inset-view";
import { useCompactHeight } from "@/ui/use-wide-layout";
import { ArchivedChatNotice } from "./archived-chat-notice";
import { BackgroundTaskBar } from "./background-task-bar";
import { resolveAttachmentPickers } from "./composer-attachments";
import {
  COMPOSER_CARD_RADIUS,
  ComposerCard,
  ComposerControlsBar,
  ComposerDock,
} from "./composer-card";
import {
  ComposerTextButton,
  GhostIconButton,
  QuietSelector,
  SendButton,
  StopButton,
} from "./composer-controls";
import { ComposerNotice, FailureNotice } from "./composer-failure-notice";
import {
  composerCardState,
  composerModelText,
  secondarySendDisabled,
  sendButtonState,
} from "./composer-presentation";
import { ContextUsageIndicator, useContextUsage } from "./context-usage-indicator";
import { GoalRow } from "./goal-row";
import { MessageQueuePanel, QueuePauseNotice } from "./message-queue-panel";
import { PendingCommentsNotice } from "./pending-comments-notice";
import { useComposerInteractions } from "./use-composer-interactions";
import { type SessionComposerModel, useSessionComposer } from "./use-session-composer";
import { type SessionStop, useSessionStop } from "./use-session-stop";

type ComposerInteractions = ReturnType<typeof useComposerInteractions>;

const MODE_LABELS = {
  default: { send: "Send message", queue: "Queue message" },
  steer: { send: "Send message", queue: "Steer message" },
} satisfies Record<AgentMessageSubmitMode, { send: string; queue: string }>;

/** The send control names what Send does now: a new turn, a queued message, or a steer. */
const sendLabelFor = (mode: AgentMessageSubmitMode, isWorking: boolean): string =>
  isWorking ? MODE_LABELS[mode].queue : MODE_LABELS[mode].send;

/**
 * The chat composer of a session, as the desktop composer: the Message Queue stacked on its top
 * edge, the background tasks and the goal of the session, then a card with the queue pause, the
 * pending review comments, the attachments, the field with its chips, and a bar with attach,
 * model, effort, context use, Stop, and Send. A light runs
 * around the card while the agent works. The draft stays editable while the host is not
 * connected. Send, steer, queue actions, and pickers wait for the connection.
 *
 * The session view lifts the composer with the keyboard. The composer keeps the bottom safe area
 * while the keyboard is closed and gives it up as the keyboard opens, frame by frame.
 */
export function SessionComposer({
  onSent,
  availableHeight,
}: {
  onSent: () => void;
  availableHeight: number;
}): ReactElement | null {
  const composer = useSessionComposer({ onSent });
  if (composer.target.readOnly) return null;
  return <SessionComposerView composer={composer} availableHeight={availableHeight} />;
}

function resolveAttachmentCapabilities(composer: SessionComposerModel) {
  const sourceSupport = composer.selectedModelDescriptor?.attachmentSupport;
  const sourceRuntimeSupportsAttachments = composer.promptInput.support.supportsAttachments;
  const handoffSelected = composer.delivery.handoff?.selection !== undefined;
  return {
    sourceSupport,
    sourceRuntimeSupportsAttachments,
    runtimeSupportsAttachments: handoffSelected
      ? composer.policy.supportsAttachments
      : sourceRuntimeSupportsAttachments,
    attachmentSupport: handoffSelected ? composer.policy.attachmentSupport : sourceSupport,
  };
}

function ComposerCardHeader({ composer }: { composer: SessionComposerModel }): ReactElement {
  const theme = useAppTheme();
  const { target, delivery } = composer;
  const pendingComments = composer.reviewComments.pendingSendItems;
  return (
    <>
      {composer.isWorking && !composer.isWaitingInput ? (
        <BorderRay
          color={runtimeAccentColor(theme, target.identity.runtimeKind)}
          radius={COMPOSER_CARD_RADIUS}
        />
      ) : null}
      {delivery.messageQueue ? <QueuePauseNotice model={delivery.messageQueue} /> : null}
      {pendingComments ? (
        <PendingCommentsNotice
          comments={pendingComments}
          workOwner={target.workOwner}
          commentOwner={composer.commentOwner}
        />
      ) : null}
    </>
  );
}

function SessionComposerView({
  composer,
  availableHeight,
}: {
  composer: SessionComposerModel;
  availableHeight: number;
}): ReactElement {
  const theme = useAppTheme();
  const compact = useCompactHeight();
  const { target, draft, editor, policy, primaryMode, submit, delivery, gateOpen } = composer;
  const stop = useSessionStop();

  const attachments = resolveAttachmentCapabilities(composer);
  const queuePickers = useMemo(
    () =>
      resolveAttachmentPickers({
        runtimeSupportsAttachments: attachments.sourceRuntimeSupportsAttachments,
        support: attachments.sourceSupport,
      }),
    [attachments.sourceRuntimeSupportsAttachments, attachments.sourceSupport],
  );

  const send = useCallback(
    (mode: AgentMessageSubmitMode) => {
      haptics.light();
      void submit(mode);
    },
    [submit],
  );
  const sendPrimary = useCallback(() => send(primaryMode), [primaryMode, send]);

  const interactions = useComposerInteractions({
    draft,
    editor,
    promptInput: composer.promptInput,
    runtimeSupportsAttachments: attachments.runtimeSupportsAttachments,
    attachmentSupport: attachments.attachmentSupport,
    isInputDisabled: policy.isComposerInputDisabled,
    attachmentsEnabled: composer.canInteract && !policy.isComposerInputDisabled,
    sendDisabled: policy.sendDisabled,
    onSend: sendPrimary,
  });

  const steerContext = useMemo<QueuedMessageSteerContext>(
    () => ({
      steerBlockedReason: delivery.steerBlockedReason,
      runningTurnModel: delivery.runningTurnModel,
      isSessionWorking: composer.isWorking,
      foregroundTurnActive: composer.foregroundTurnActive,
      isWaitingInput: composer.isWaitingInput,
    }),
    [
      composer.foregroundTurnActive,
      composer.isWaitingInput,
      composer.isWorking,
      delivery.runningTurnModel,
      delivery.steerBlockedReason,
    ],
  );

  // The session screen covers the tabs, so the composer keeps the bottom safe area. The keyboard
  // covers that padding when it opens.
  const keyboardPadding = useBottomEdgePadding(theme.space.sm);
  const editable = !policy.isComposerInputDisabled;
  // The card state picks a whole style entry: a variant would build the stylesheet again on each
  // keystroke, and the composer renders on each one.
  const cardState = composerCardState({
    isWaitingInput: composer.isWaitingInput,
    inputDisabled: policy.isComposerInputDisabled,
    isSubmitting: policy.isSubmitting,
  });
  const cardMaxHeight =
    availableHeight > 0
      ? Math.max(0, availableHeight - theme.space.xs - keyboardPadding.paddingBottom)
      : undefined;
  const commandsOpen = gateOpen && composer.canInteract;

  return (
    <ComposerDock
      keyboardPadding={keyboardPadding}
      notices={<ComposerNotices composer={composer} stopFailure={stop.failure} />}
      trigger={interactions.trigger}
      suggestions={interactions.suggestions}
      supportsSubagentReferences={composer.promptInput.support.supportsSubagentReferences}
      onPickSuggestion={interactions.pickSuggestion}
    >
      <HandoffCue
        notice={delivery.handoff?.notice}
        currentRuntime={target.identity.runtimeKind}
        sourceModel={composer.selectedModelDescriptor?.modelName}
      />
      {/* The queue stack tucks its front card under the composer card, so no gap parts them. */}
      <View style={styles.queueAndCard}>
        {delivery.messageQueue ? (
          <MemoMessageQueuePanel
            model={delivery.messageQueue}
            steerContext={steerContext}
            commandsOpen={commandsOpen}
            pickers={queuePickers}
            attachmentSupport={attachments.sourceSupport}
          />
        ) : null}
        <BackgroundTaskBar model={composer.backgroundTasks} commandsOpen={commandsOpen} />
        {composer.goalRow ? <GoalRow model={composer.goalRow} commandsOpen={commandsOpen} /> : null}
        <ComposerCard
          cardState={cardState}
          header={<ComposerCardHeader composer={composer} />}
          attachments={draft.attachments ?? []}
          attachmentErrors={policy.attachmentErrors}
          editable={editable}
          onRemoveAttachment={editor.removeAttachment}
          hasSlashAttachmentConflict={policy.hasSlashAttachmentConflict}
          compact={compact}
          maxHeight={cardMaxHeight}
          focused={interactions.focused}
          onHardwareEnter={interactions.onHardwareEnter}
          onFocusChange={interactions.onFocusChange}
          editor={editor}
          placeholder={composer.isWaitingInput ? "Waiting" : composer.fieldText.placeholder}
          accessibilityHint={composer.fieldText.hint}
          sendBlockedReason={policy.sendBlockedReason}
          controls={
            <ComposerControls
              composer={composer}
              compact={compact}
              stop={stop}
              pickers={interactions.pickers}
              attachmentPickers={interactions.attachmentPickers}
              onSend={send}
            />
          }
        />
      </View>
    </ComposerDock>
  );
}

function HandoffCue({
  notice,
  currentRuntime,
  sourceModel,
}: {
  notice: NonNullable<SessionComposerModel["delivery"]["handoff"]>["notice"] | undefined;
  currentRuntime: SessionComposerModel["target"]["identity"]["runtimeKind"];
  sourceModel: string | undefined;
}): ReactElement | null {
  if (!notice) return null;
  const action = notice.check ?? notice.cancel;
  return (
    <View>
      <RuntimeHandoffIndicator
        direction={notice.direction}
        title={notice.title}
        detail={notice.details}
        sourceModel={currentRuntime === notice.direction.from ? sourceModel : undefined}
        destinationModel={notice.destinationModel}
        live
      />
      {action ? (
        <View style={styles.handoffAction}>
          <ComposerTextButton
            label={notice.check ? "Check delivery" : "Cancel handoff"}
            variant={notice.check ? "outline" : "ghost"}
            onPress={action}
          />
        </View>
      ) : null}
    </View>
  );
}

/**
 * The notices above the composer: an archived chat with Restore Chat, the last send failure, a
 * Stop failure, and a settings read.
 */
function ComposerNotices({
  composer,
  stopFailure,
}: {
  composer: SessionComposerModel;
  stopFailure: SessionStop["failure"];
}): ReactElement {
  const { owner, workspace } = composer.target;
  return (
    <>
      {owner.kind === "chat" && owner.record.archivedAt !== null ? (
        <ArchivedChatNotice workspace={workspace} record={owner.record} />
      ) : null}
      {composer.failure ? (
        <FailureNotice failure={composer.failure} onDismiss={composer.dismissFailure} />
      ) : null}
      {stopFailure ? (
        <ComposerNotice
          tone={stopFailure.kind === "unknown" ? "warning" : "destructive"}
          title={stopFailure.title}
          message={stopFailure.message}
        />
      ) : null}
      {composer.settingsLoadError ? (
        <ComposerNotice
          tone="destructive"
          title="Session settings could not load"
          message={`${composer.settingsLoadError.message} Send waits for the session settings.`}
          action={
            <ComposerTextButton
              label="Retry Settings"
              icon="refresh-ccw"
              variant="outline"
              onPress={composer.retrySettings}
            />
          }
        />
      ) : null}
    </>
  );
}

function composerModelForNextMessage(composer: SessionComposerModel) {
  const handoff = composer.delivery.handoff?.selection;
  const runtimeKind = handoff?.model.runtimeKind ?? composer.target.identity.runtimeKind;
  const runtime = RUNTIME_DESCRIPTORS_BY_KIND[runtimeKind];
  const model = composerModelText({
    selectedModel: handoff?.model ?? composer.selectedModel,
    modelName: handoff?.descriptor.modelName ?? composer.selectedModelDescriptor?.modelName,
    catalog: handoff ? null : composer.modelCatalog,
    runtime,
  });
  return {
    ...model,
    runtimeKind,
    accessibilityLabel: handoff
      ? `Select model, ${runtime.label}, ${model.label}`
      : model.accessibilityLabel,
    accessibilityHint: handoff
      ? "Opens the model picker."
      : "Opens the model, profile, effort, and speed.",
  };
}

/** The bar of the composer card: attach and the model on the start; usage, Stop, and Send on the end. */
function ComposerControls({
  composer,
  compact,
  stop,
  pickers,
  attachmentPickers,
  onSend,
}: {
  composer: SessionComposerModel;
  compact: boolean;
  stop: SessionStop;
  pickers: ComposerInteractions["pickers"];
  attachmentPickers: ComposerInteractions["attachmentPickers"];
  onSend: (mode: AgentMessageSubmitMode) => void;
}): ReactElement {
  const router = useRouter();
  const { target, policy, draft, primaryMode, secondaryMode } = composer;
  const sessionContextUsage = useSessionSelector(target.identity, selectContextUsage, Object.is);
  const contextUsage = useContextUsage({
    contextUsage: sessionContextUsage,
    catalog: composer.modelCatalog,
    selectedModel: composer.selectedModel,
  });
  const model = composerModelForNextMessage(composer);
  const openOptions = useCallback((): void => {
    // The field gives up the focus, so Android does not open the keyboard over the options sheet
    // when a picker of the sheet closes.
    blurFocusedField();
    router.push(
      routes.composerOptions({
        workspaceId: target.workspace.workspaceId,
        externalSessionId: target.identity.externalSessionId,
        runtimeKind: target.identity.runtimeKind,
        workingDirectory: target.identity.workingDirectory,
      }),
    );
  }, [router, target]);
  const pendingComments = composer.reviewComments.pendingSendItems;
  const pendingCount = pendingComments?.count ?? 0;
  const draftHasContent = useMemo(() => draftHasMeaningfulContent(draft), [draft]);
  const hasContent = draftHasContent || pendingCount > 0;
  const sendState = sendButtonState({
    hasContent,
    sendDisabled: policy.sendDisabled,
    busy: policy.isSubmitting,
  });
  return (
    <ComposerControlsBar
      compact={compact}
      pickers={pickers}
      attachmentPickers={attachmentPickers}
      modelSelector={
        <QuietSelector
          leading={<RuntimeIcon runtimeKind={model.runtimeKind} size={16} />}
          profile={model.profile}
          label={model.label}
          detail={model.effort}
          speedTone={model.speedTone}
          accessibilityLabel={model.accessibilityLabel}
          accessibilityHint={model.accessibilityHint}
          disabled={composer.modelOptionsDisabled}
          onPress={openOptions}
        />
      }
      endControls={
        <>
          {contextUsage ? (
            <View style={styles.contextUsage}>
              <ContextUsageIndicator usage={contextUsage} />
            </View>
          ) : null}
          {secondaryMode && hasContent ? (
            <SecondarySendButton composer={composer} mode={secondaryMode} onSend={onSend} />
          ) : null}
          {stop.available ? (
            <StopButton
              stopping={stop.isStopping}
              connected={composer.gateOpen}
              onStop={stop.stop}
            />
          ) : null}
          <SendButton
            enabled={sendState === "ready"}
            busy={sendState === "busy"}
            label={sendLabelFor(primaryMode, composer.isWorking)}
            hint={
              policy.sendBlockedReason ?? (composer.canInteract ? null : composer.blockedReason)
            }
            pendingCount={pendingCount}
            pendingLabel={pendingComments?.accessibleLabel ?? null}
            onPress={() => onSend(primaryMode)}
          />
        </>
      }
    />
  );
}

/** Steer or Queue for one message while a turn runs: the other mode than the primary one. */
function SecondarySendButton({
  composer,
  mode,
  onSend,
}: {
  composer: SessionComposerModel;
  mode: AgentMessageSubmitMode;
  onSend: (mode: AgentMessageSubmitMode) => void;
}): ReactElement {
  const { policy } = composer;
  const steer = mode === "steer";
  const steerLabel = policy.sendBlockedReason
    ? `Steer this message into the running turn. ${policy.sendBlockedReason}`
    : "Steer this message into the running turn";
  return (
    <GhostIconButton
      icon={steer ? "zap" : "list-plus"}
      accessibilityLabel={steer ? steerLabel : "Queue this message"}
      disabled={secondarySendDisabled({
        mode,
        gateOpen: composer.gateOpen,
        settingsReady: composer.settingsReady,
        sendInputBlocked: policy.sendInputBlocked,
        defaultSendDisabled: policy.defaultSendDisabled,
        steerBlockedReason: composer.delivery.steerBlockedReason,
      })}
      onPress={() => onSend(mode)}
    />
  );
}

const MemoMessageQueuePanel = memo(MessageQueuePanel);

const selectContextUsage = (session: AgentSessionState | null): AgentSessionContextUsage | null =>
  session?.contextUsage ?? null;

const styles = StyleSheet.create({
  handoffAction: { alignSelf: "flex-end" },
  queueAndCard: { flexShrink: 1, minHeight: 0 },
  contextUsage: { marginRight: touchSlop(28) - touchSlop(32) },
});
