import type { AgentMessageSubmitMode } from "@openducktor/contracts";
import { draftHasMeaningfulContent } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import type { QueuedMessageSteerContext } from "@openducktor/frontend-core/sessions/send/agent-chat-steering";
import { useRouter } from "expo-router";
import { memo, type ReactElement, useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { routes } from "@/navigation/routes";
import { useAppTheme } from "@/theme/app-theme-context";
import { runtimeAccentColor } from "@/theme/runtime-accent";
import { touchSlop } from "@/theme/tokens";
import { haptics } from "@/ui/haptics";
import { BorderRay } from "@/ui/border-ray";
import { useBottomEdgePadding } from "@/ui/keyboard-inset-view";
import { blurFocusedField } from "@/ui/keyboard-dismiss";
import { Text } from "@/ui/text";
import { useSessionFacts } from "@/features/session/use-session-facts";
import { withAlpha } from "@/theme/color-alpha";
import { RuntimeIcon } from "@/ui/brand-icons";
import { HardwareKeyboardView } from "../../../modules/openducktor-keyboard";
import { ArchivedChatNotice } from "./archived-chat-notice";
import { ComposerAttachButton } from "./composer-attach-button";
import { ComposerAttachmentStrip } from "./composer-attachment-strip";
import { type AttachmentPickers, resolveAttachmentPickers } from "./composer-attachments";
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
import {
  type ComposerSuggestion,
  readComposerTrigger,
  insertSuggestionEdit,
} from "./composer-segments";
import { ComposerSuggestionList } from "./composer-suggestion-list";
import { ComposerTextField } from "./composer-text-field";
import { resolveHardwareEnter } from "./hardware-enter";
import { ContextUsageIndicator, useContextUsage } from "./context-usage-indicator";
import { MessageQueuePanel, QueuePauseNotice } from "./message-queue-panel";
import { PendingCommentsNotice } from "./pending-comments-notice";
import { useAttachmentPickers } from "./use-attachment-pickers";
import { useComposerSuggestions } from "./use-composer-suggestions";
import { type SessionComposerModel, useSessionComposer } from "./use-session-composer";
import { type SessionStop, useSessionStop } from "./use-session-stop";

type AttachmentPicking = ReturnType<typeof useAttachmentPickers>;

const MODE_LABELS = {
  default: { send: "Send message", queue: "Queue message" },
  steer: { send: "Send message", queue: "Steer message" },
} satisfies Record<AgentMessageSubmitMode, { send: string; queue: string }>;

/** The send control names what Send does now: a new turn, a queued message, or a steer. */
const sendLabelFor = (mode: AgentMessageSubmitMode, isWorking: boolean): string =>
  isWorking ? MODE_LABELS[mode].queue : MODE_LABELS[mode].send;

/** The field grows with the text to about six lines, then scrolls. */
const INPUT_MAX_HEIGHT = 156;
/** The desktop composer card corner: `rounded-xl`. */
const CARD_RADIUS = 16;

/**
 * The chat composer of a session, as the desktop composer: the Message Queue stacked on its top
 * edge, then a card with the queue pause, the pending review comments, the attachments, the field
 * with its chips, and a bar with attach, model, effort, context use, Stop, and Send. A light runs
 * around the card while the agent works. The draft stays editable while the host is not
 * connected. Send, steer, queue actions, and pickers wait for the connection.
 *
 * The session view lifts the composer with the keyboard. The composer keeps the bottom safe area
 * while the keyboard is closed and gives it up as the keyboard opens, frame by frame.
 */
export function SessionComposer({ onSent }: { onSent: () => void }): ReactElement | null {
  const composer = useSessionComposer({ onSent });
  if (composer.target.readOnly) return null;
  return <SessionComposerView composer={composer} />;
}

function SessionComposerView({ composer }: { composer: SessionComposerModel }): ReactElement {
  const theme = useAppTheme();
  const { target, draft, editor, policy, fieldText, primaryMode, submit, delivery, gateOpen } =
    composer;
  const [focused, setFocused] = useState(false);
  const stop = useSessionStop();
  const { noteFocus } = editor;
  const onFocusChange = useCallback(
    (next: boolean) => {
      setFocused(next);
      noteFocus(next);
    },
    [noteFocus],
  );
  const { trigger, suggestions, pickSuggestion } = useComposerTrigger(composer, focused);

  const support = composer.promptInput.support;
  const pickers = useMemo(
    () =>
      resolveAttachmentPickers({
        runtimeSupportsAttachments: support.supportsAttachments,
        support: composer.selectedModelDescriptor?.attachmentSupport,
      }),
    [composer.selectedModelDescriptor?.attachmentSupport, support.supportsAttachments],
  );
  const attachmentPickers = useAttachmentPickers({
    pickers,
    enabled: composer.canInteract && !policy.isComposerInputDisabled && !policy.isSubmitting,
    onAdd: editor.addAttachments,
  });

  const send = useCallback(
    (mode: AgentMessageSubmitMode) => {
      haptics.light();
      void submit(mode);
    },
    [submit],
  );
  const onHardwareEnter = useCallback(
    ({ nativeEvent }: { nativeEvent: { shift: boolean } }) => {
      const action = resolveHardwareEnter({
        shift: nativeEvent.shift,
        suggestionRows: trigger ? suggestions.items.length : null,
        sendAllowed: !policy.sendDisabled,
      });
      const first = suggestions.items[0];
      if (action === "pick_suggestion" && first) pickSuggestion(first);
      if (action === "send") send(primaryMode);
    },
    [pickSuggestion, policy.sendDisabled, primaryMode, send, suggestions.items, trigger],
  );

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
  const pendingComments = composer.reviewComments.pendingSendItems;
  // The card state picks a whole style entry: a variant would build the stylesheet again on each
  // keystroke, and the composer renders on each one.
  const cardState = composerCardState({
    isWaitingInput: composer.isWaitingInput,
    inputDisabled: policy.isComposerInputDisabled,
    isSubmitting: policy.isSubmitting,
  });

  return (
    <Animated.View style={[styles.container, keyboardPadding]}>
      <ComposerNotices composer={composer} stopFailure={stop.failure} />
      {/*
        The suggestions take room above the composer instead of floating over the transcript.
        Android sends a touch only to views inside the bounds of their parents, so a floating
        panel let the transcript under it take the touch, and a selectable transcript text then
        took the focus and closed the keyboard.
      */}
      {trigger ? (
        <ComposerSuggestionList
          trigger={trigger}
          suggestions={suggestions}
          supportsSubagentReferences={support.supportsSubagentReferences}
          onPick={pickSuggestion}
        />
      ) : null}
      {/* The queue stack tucks its front card under the composer card, so no gap parts them. */}
      <View style={styles.queueAndCard}>
        {delivery.messageQueue ? (
          <MemoMessageQueuePanel
            model={delivery.messageQueue}
            steerContext={steerContext}
            commandsOpen={gateOpen && composer.canInteract}
            pickers={pickers}
          />
        ) : null}
        <View style={cardStyleOf(cardState)}>
          {composer.isWorking && !composer.isWaitingInput ? (
            <BorderRay
              color={runtimeAccentColor(theme, target.identity.runtimeKind)}
              radius={CARD_RADIUS}
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
          <ComposerAttachmentStrip
            attachments={draft.attachments ?? []}
            errors={policy.attachmentErrors}
            editable={editable}
            onRemove={editor.removeAttachment}
          />
          {policy.hasSlashAttachmentConflict ? (
            <Text variant="footnote" style={styles.conflict}>
              Remove attachments before running a slash command.
            </Text>
          ) : null}
          <HardwareKeyboardView enabled={focused} onHardwareEnter={onHardwareEnter}>
            <ComposerTextField
              layout={editor.layout}
              editable={editable}
              placeholder={fieldText.placeholder}
              accessibilityLabel="Message"
              accessibilityHint={fieldText.hint}
              maxHeight={INPUT_MAX_HEIGHT}
              selectionRequest={editor.selectionRequest}
              onChangeText={editor.changeText}
              onSelectionChange={editor.select}
              onFocusChange={onFocusChange}
            />
          </HardwareKeyboardView>
          {policy.sendBlockedReason ? (
            <Text variant="footnote" style={styles.sendNotice} accessibilityRole="text">
              {policy.sendBlockedReason}
            </Text>
          ) : null}
          <ComposerControls
            composer={composer}
            stop={stop}
            pickers={pickers}
            attachmentPickers={attachmentPickers}
            onSend={send}
          />
        </View>
      </View>
    </Animated.View>
  );
}

/** The trigger at the caret, such as `@` or `/`, and the suggestions that it shows. */
const useComposerTrigger = (composer: SessionComposerModel, focused: boolean) => {
  const { draft, editor, policy, promptInput } = composer;
  // The prompt input builds `support` on each render, so the trigger reads its flags.
  const { supportsFileSearch, supportsSubagentReferences, supportsSkillReferences } =
    promptInput.support;
  const supportsSlashCommands = promptInput.slashCommands.supportsSlashCommands;
  const triggerSupport = useMemo(
    () => ({
      // Reusable prompts of the host settings are slash commands too, as on desktop.
      supportsSlashCommands,
      supportsFileSearch,
      supportsSubagentReferences,
      supportsSkillReferences,
    }),
    [
      supportsFileSearch,
      supportsSkillReferences,
      supportsSlashCommands,
      supportsSubagentReferences,
    ],
  );
  const caret = editor.caret;
  const trigger = useMemo(
    () =>
      focused && caret && !policy.isComposerInputDisabled
        ? readComposerTrigger(draft, caret.segmentId, caret.offset, triggerSupport)
        : null,
    [caret, draft, focused, policy.isComposerInputDisabled, triggerSupport],
  );
  const suggestions = useComposerSuggestions(trigger, promptInput);
  const { applyStructuralEdit } = editor;
  const pickSuggestion = useCallback(
    (suggestion: ComposerSuggestion) => {
      if (trigger) applyStructuralEdit(insertSuggestionEdit(trigger, suggestion));
    },
    [applyStructuralEdit, trigger],
  );
  return { trigger, suggestions, pickSuggestion };
};

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
          title="Chat settings could not load"
          message={`${composer.settingsLoadError.message} Send waits for the chat settings.`}
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

/** The bar of the composer card: attach and the model on the start; usage, Stop, and Send on the end. */
function ComposerControls({
  composer,
  stop,
  pickers,
  attachmentPickers,
  onSend,
}: {
  composer: SessionComposerModel;
  stop: SessionStop;
  pickers: AttachmentPickers;
  attachmentPickers: AttachmentPicking;
  onSend: (mode: AgentMessageSubmitMode) => void;
}): ReactElement {
  const router = useRouter();
  const { target, policy, draft, primaryMode, secondaryMode } = composer;
  const facts = useSessionFacts();
  const contextUsage = useContextUsage({
    contextUsage: facts.contextUsage,
    catalog: composer.modelCatalog,
    selectedModel: composer.selectedModel,
  });
  const runtimeKind = target.identity.runtimeKind;
  const model = composerModelText({
    selectedModel: composer.selectedModel,
    modelName: composer.selectedModelDescriptor?.modelName,
    catalog: composer.modelCatalog,
  });
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
    <View style={styles.controls}>
      <View style={styles.controlsStart}>
        <ComposerAttachButton pickers={pickers} picking={attachmentPickers} />
        <QuietSelector
          leading={<RuntimeIcon runtimeKind={runtimeKind} size={16} />}
          label={model.label}
          detail={model.effort}
          accessibilityLabel={model.info ? `Select model, ${model.info}` : "Select model"}
          accessibilityHint="Opens the model, profile, effort, and speed."
          disabled={composer.modelOptionsDisabled}
          onPress={openOptions}
        />
      </View>
      <View style={styles.controlsEnd}>
        {contextUsage ? <ContextUsageIndicator usage={contextUsage} /> : null}
        {secondaryMode && hasContent ? (
          <SecondarySendButton composer={composer} mode={secondaryMode} onSend={onSend} />
        ) : null}
        {stop.available ? (
          <StopButton stopping={stop.isStopping} connected={composer.gateOpen} onStop={stop.stop} />
        ) : null}
        <SendButton
          enabled={sendState === "ready"}
          busy={sendState === "busy"}
          label={sendLabelFor(primaryMode, composer.isWorking)}
          hint={policy.sendBlockedReason ?? (composer.canInteract ? null : composer.blockedReason)}
          pendingCount={pendingCount}
          pendingLabel={pendingComments?.accessibleLabel ?? null}
          onPress={() => onSend(primaryMode)}
        />
      </View>
    </View>
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

const cardStyleOf = (state: ReturnType<typeof composerCardState>) => {
  switch (state) {
    case "active":
      return styles.cardActive;
    case "muted":
      return styles.cardMuted;
    case "waiting":
      return styles.cardWaiting;
  }
};

const styles = StyleSheet.create((theme) => ({
  // The composer shrinks when the screen has no room for it: the suggestion list and the queue
  // give up height, and the card keeps its height, so the field and Send stay above the keyboard.
  container: {
    flexShrink: 1,
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.xs,
    backgroundColor: theme.colors.background,
  },
  queueAndCard: { flexShrink: 1 },
  // The desktop card has no border: its chat surface and shadow set it apart from the transcript.
  // While the session waits for input, it has the warning outline and glow. While input is off,
  // its surface fades.
  cardActive: {
    borderRadius: CARD_RADIUS,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.chatSurface,
    boxShadow: theme.shadows.raised,
  },
  cardMuted: {
    borderRadius: CARD_RADIUS,
    borderCurve: "continuous",
    backgroundColor: withAlpha(theme.desktop.chatSurface, 0.6),
  },
  cardWaiting: {
    borderRadius: CARD_RADIUS,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.warningBorder,
    backgroundColor: theme.desktop.chatSurface,
    // `.odt-waiting-input-card`: a 72% warning border ring and a 30% warning ring glow.
    boxShadow: `0 0 0 1px ${withAlpha(theme.desktop.warningBorder, 0.72)}, 0 0 18px ${withAlpha(theme.desktop.warningRing, 0.3)}`,
  },
  conflict: {
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.sm,
    color: theme.desktop.destructive,
  },
  sendNotice: {
    paddingHorizontal: theme.space.md,
    paddingBottom: theme.space.sm,
    color: theme.desktop.mutedForeground,
  },
  // The desktop bar: `flex flex-wrap items-end gap-2 px-2 pb-2 pt-1`. The gaps between controls
  // hold their touch areas, so no touch area covers a neighbor: 28-point controls on the start,
  // 28 and 32-point controls on the end.
  controls: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2 * touchSlop(28),
    paddingHorizontal: theme.space.sm,
    paddingBottom: theme.space.sm,
    paddingTop: theme.space.xs,
  },
  controlsStart: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 2 * touchSlop(28),
    minHeight: 32,
  },
  controlsEnd: {
    flexDirection: "row",
    alignItems: "center",
    gap: touchSlop(28) + touchSlop(32),
  },
}));
