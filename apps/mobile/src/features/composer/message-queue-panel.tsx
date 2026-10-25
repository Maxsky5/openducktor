import type {
  AgentMessageQueueAction,
  AgentQueuedMessage,
  AgentSessionUserMessagePart,
} from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import type { AgentChatComposerDraft } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import {
  type ComposerFailure,
  describeComposerFailure,
} from "@openducktor/frontend-core/sessions/composer/composer-failure";
import type { QueuedMessageSteerContext } from "@openducktor/frontend-core/sessions/send/agent-chat-steering";
import type { AgentChatMessageQueueModel } from "@openducktor/frontend-core/sessions/send/agent-chat.types";
import { useSingleFlight } from "@openducktor/frontend-core/lib/use-single-flight";
import {
  Fragment,
  memo,
  type ReactElement,
  type ReactNode,
  useCallback,
  useMemo,
  useState,
} from "react";
import { ScrollView, View } from "react-native";
import Animated, { FadeIn, ReduceMotion } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { ReferenceChip, type ReferenceChipProps } from "@/features/session/reference-chip";
import { type AppTheme, motion, touchSlop } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { ATTACHMENT_KIND_ICONS, type AttachmentPickers } from "./composer-attachments";
import { ComposerTextButton } from "./composer-controls";
import { FailureNotice } from "./composer-failure-notice";
import { type EditingEntry, QueuedMessageEditorSheet } from "./queued-message-editor";
import { type QueueItemView, buildQueueItemView, queueCardLabel } from "./queue-item-state";
import { useQueueActions } from "./use-queue-actions";

type RowAction = Extract<AgentMessageQueueAction, { kind: "steer" | "begin_edit" | "remove" }>;

const EMPTY_ENTRIES: readonly AgentQueuedMessage[] = [];

/** The older cards that peek behind the front card of a closed stack. */
const MAX_PEEKING = 2;
/** The desktop `--queue-peek` and `--queue-card-tuck`. */
const PEEK = 7;
const TUCK = 6;
/** The desktop `--queue-depth-scale`. */
const DEPTH_SCALE = 0.05;
/** The line height of the card text, which the state glyph sits on. */
const CARD_LINE_HEIGHT = 20;

/**
 * New messages, the older cards of an opening stack, and the peeks of a closing stack fade in. The
 * front card keeps its place on the screen in both states, so it does not move. Leaving views go
 * at once: the stack changes height, and a fading view would show at its old place in the stack.
 */
const STACK_ENTERING = FadeIn.duration(motion.base).reduceMotion(ReduceMotion.System);

const isEditingEntry = (entry: AgentQueuedMessage): entry is EditingEntry =>
  entry.state === "editing";

/**
 * The Message Queue on the top edge of the composer, as the desktop queued message stack: the
 * newest message in front, with up to two older cards peeking behind it. A press opens the stack
 * and shows every message in full with Steer now, Edit, and Remove; another press closes it. A
 * message that the user edits leaves the stack for its edit card, and the edit opens in a sheet.
 * A message whose delivery is unknown shows that state and offers no action, so the app never
 * sends it twice.
 */
export function MessageQueuePanel({
  model,
  steerContext,
  commandsOpen,
  pickers,
}: {
  model: AgentChatMessageQueueModel;
  steerContext: QueuedMessageSteerContext;
  commandsOpen: boolean;
  /** The attachment pickers that an edit of a queued message offers. */
  pickers: AttachmentPickers;
}): ReactElement | null {
  const { queue, onAction, onSaveEdit } = model;
  const { running, failures, run } = useQueueActions();
  const [spread, setSpread] = useState(false);
  // The message whose edit sheet is open. The sheet shows once the host reports the edit.
  const [openSubmissionId, setOpenSubmissionId] = useState<string | null>(null);

  const editDrafts = useClientConnection().drafts.queuedMessageEdits;
  const runRowAction = useCallback(
    (action: RowAction) => {
      if (action.kind === "begin_edit") setOpenSubmissionId(action.submissionId);
      run(action.submissionId, action.kind, () => onAction(action));
    },
    [onAction, run],
  );
  const toggleSpread = useCallback(() => setSpread((current) => !current), []);

  const entries = queue?.entries ?? EMPTY_ENTRIES;
  const views = useMemo(
    () =>
      entries.map((entry) =>
        buildQueueItemView(entry, {
          steerContext,
          actionRuns: running.has(entry.submissionId),
          commandsOpen,
        }),
      ),
    [commandsOpen, entries, running, steerContext],
  );
  if (!queue || entries.length === 0) return null;

  const stacked = views.filter((view) => !view.isEditing);
  const edited = views.filter((view) => view.isEditing);
  const openEntry =
    entries.find(
      (entry): entry is EditingEntry =>
        isEditingEntry(entry) && entry.submissionId === openSubmissionId,
    ) ?? null;
  const openAction = openEntry ? running.get(openEntry.submissionId)?.kind : undefined;
  // An ended edit no longer needs its sheet or its unsaved draft.
  const endEdit = (entry: EditingEntry) => (): void => {
    editDrafts.clear(queue.target, entry.editId);
    setOpenSubmissionId(null);
  };
  const shownFailures = views.flatMap((view) => {
    const failure = failures.get(view.submissionId);
    return failure && !(openEntry && openEntry.submissionId === view.submissionId)
      ? [{ id: view.submissionId, failure }]
      : [];
  });

  return (
    <View style={styles.panel} accessibilityLabel="Message queue">
      {shownFailures.map(({ id, failure }) => (
        <View key={id} style={styles.failure}>
          <FailureNotice failure={failure} />
        </View>
      ))}
      {edited.map((view) => (
        <EditingCard key={view.submissionId} view={view} onContinue={setOpenSubmissionId} />
      ))}
      {stacked.length > 0 ? (
        <QueueStack
          views={stacked}
          isPaused={queue.pause !== null}
          spread={spread}
          onToggle={toggleSpread}
          onAction={runRowAction}
        />
      ) : null}
      <QueuedMessageEditorSheet
        target={queue.target}
        entry={openEntry}
        pickers={pickers}
        commandsOpen={commandsOpen}
        isPending={openAction !== undefined && openAction !== "begin_edit"}
        isSaving={openAction === "save_edit"}
        failure={openEntry ? (failures.get(openEntry.submissionId) ?? null) : null}
        onClose={() => setOpenSubmissionId(null)}
        onSave={(draft: AgentChatComposerDraft) => {
          if (!openEntry) return;
          run(
            openEntry.submissionId,
            "save_edit",
            () =>
              onSaveEdit({ submissionId: openEntry.submissionId, editId: openEntry.editId }, draft),
            endEdit(openEntry),
          );
        }}
        onCancel={() => {
          if (!openEntry) return;
          run(
            openEntry.submissionId,
            "cancel_edit",
            () =>
              onAction({
                kind: "cancel_edit",
                submissionId: openEntry.submissionId,
                editId: openEntry.editId,
              }),
            endEdit(openEntry),
          );
        }}
        onRemove={() => {
          if (!openEntry) return;
          run(
            openEntry.submissionId,
            "remove",
            () =>
              onAction({
                kind: "remove",
                submissionId: openEntry.submissionId,
                editId: openEntry.editId,
              }),
            endEdit(openEntry),
          );
        }}
      />
    </View>
  );
}

/**
 * The stack of queued messages in delivery order: the first message goes out first, and the last
 * one is the front card next to the composer.
 */
function QueueStack({
  views,
  isPaused,
  spread,
  onToggle,
  onAction,
}: {
  views: readonly QueueItemView[];
  isPaused: boolean;
  spread: boolean;
  onToggle: () => void;
  onAction: (action: RowAction) => void;
}): ReactElement {
  const count = views.length;
  // A closed stack shows only the front card, the last message, with older cards peeking behind.
  const shown = spread ? views : views.slice(-1);
  const peeking = spread ? 0 : Math.min(count - 1, MAX_PEEKING);
  return (
    <View style={styles.stack}>
      {Array.from({ length: peeking }, (_, index) => {
        // The oldest shown card is the deepest one.
        const depth = peeking - index;
        return (
          <Animated.View
            key={depth}
            entering={STACK_ENTERING}
            style={[styles.peek, styles.peekDepth(depth)]}
          />
        );
      })}
      {/*
        An open stack scrolls when the screen has no room for every message, so the composer field
        stays above the keyboard. The closed stack keeps the same scroll view with scrolling off,
        so the front card keeps its place in the tree.
      */}
      <ScrollView
        scrollEnabled={spread}
        keyboardShouldPersistTaps="always"
        style={styles.cards}
        contentContainerStyle={spread ? styles.spreadList : null}
      >
        {/* The queue holds few messages, and each card fades in at its place in the tree. */}
        {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
        {shown.map((view) => (
          // The front card keeps its place in the tree, so it stays while older cards fade in. A
          // new message fades in as the front card.
          <Animated.View key={view.submissionId} entering={STACK_ENTERING}>
            <QueueCard
              view={view}
              count={count}
              isFront={view === views[count - 1]}
              isPaused={isPaused}
              spread={spread}
              onToggle={onToggle}
              onAction={onAction}
            />
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}

/** The state glyph of a queued message: it waits, it is on its way, or it needs the user. */
const glyphFor = (
  theme: AppTheme,
  view: QueueItemView,
  isPaused: boolean,
): { icon: IconName; color: string } | "spinner" => {
  if (view.state === "sending" || view.state === "steering") return "spinner";
  const dark = theme.scheme === "dark";
  if (view.state === "acceptance_unknown") {
    return {
      icon: "triangle-alert",
      color: dark ? theme.palette.amber400 : theme.palette.amber600,
    };
  }
  if (view.error) {
    return { icon: "circle-alert", color: dark ? theme.palette.rose400 : theme.palette.rose600 };
  }
  return { icon: isPaused ? "pause" : "clock-3", color: theme.desktop.mutedForeground };
};

/**
 * One queued message card: a dashed outline and muted text mark a message that the agent has not
 * received yet. A closed card shows one line; an open card shows the whole message, its
 * attachments, its problems, and its actions.
 */
const QueueCard = memo(function QueueCard({
  view,
  count,
  isFront,
  isPaused,
  spread,
  onToggle,
  onAction,
}: {
  view: QueueItemView;
  count: number;
  isFront: boolean;
  isPaused: boolean;
  spread: boolean;
  onToggle: () => void;
  onAction: (action: RowAction) => void;
}): ReactElement {
  const theme = useAppTheme();
  styles.useVariants({ front: isFront });
  const glyph = glyphFor(theme, view, isPaused);
  const attachmentNames = view.attachmentNames;
  const label = queueCardLabel(view, { spread, count });
  // A message on its way, or with an unknown delivery, shows its state instead of the actions.
  const delivery = view.state === "queued" || view.state === "editing" ? null : view.statusLabel;
  return (
    <View style={styles.card}>
      <Touchable
        feedback="opacity"
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={
          spread ? "Hides the queued messages." : "Shows each queued message and its actions."
        }
        accessibilityState={{ expanded: spread, busy: view.state !== "queued" }}
        containerStyle={styles.grow}
        style={styles.cardContent}
      >
        <View style={styles.glyph}>
          {glyph === "spinner" ? (
            <LoaderSpinner size={14} color={theme.desktop.mutedForeground} />
          ) : (
            <Icon name={glyph.icon} size={14} colorValue={glyph.color} />
          )}
        </View>
        <View style={styles.grow}>
          <Text numberOfLines={spread ? 6 : 1} style={styles.cardText}>
            <QueuedMessageInline parts={view.parts} fallback={attachmentNames.join(", ")} />
          </Text>
          {spread ? <QueueCardDetails view={view} /> : null}
        </View>
        {!spread && attachmentNames.length > 0 ? (
          <View style={styles.attachmentCount}>
            <Icon name="paperclip" size={12} colorValue={theme.desktop.mutedForeground} />
            <Text variant="caption2" tabular style={styles.trailingText}>
              {attachmentNames.length}
            </Text>
          </View>
        ) : null}
      </Touchable>
      {delivery || !spread ? (
        <Text variant="caption2" style={[styles.trailingText, styles.trailing]}>
          {delivery || (count > 1 ? `${count} queued` : "Queued")}
        </Text>
      ) : (
        <QueueCardActions view={view} onAction={onAction} />
      )}
    </View>
  );
});

/** The rest of an open card: its attachments, its note, and its error. */
function QueueCardDetails({ view }: { view: QueueItemView }): ReactElement {
  return (
    <>
      {view.attachmentNames.length > 0 ? (
        <View style={styles.attachments}>
          {view.parts.map((part, index) =>
            part.kind === "attachment" ? (
              <QueuedAttachmentChip
                // Message parts have no ID; the order of a message never changes.
                // react-doctor-disable-next-line react-doctor/no-array-index-as-key
                key={index}
                part={part}
              />
            ) : null,
          )}
        </View>
      ) : null}
      {view.note ? (
        <Text variant="footnote" style={styles.note}>
          {view.note}
        </Text>
      ) : null}
      {view.error ? (
        <Text variant="footnote" selectable style={styles.error}>
          {view.error}
        </Text>
      ) : null}
    </>
  );
}

/** The Steer, Edit, and Remove actions of an open card. */
function QueueCardActions({
  view,
  onAction,
}: {
  view: QueueItemView;
  onAction: (action: RowAction) => void;
}): ReactElement {
  return (
    <View style={styles.actions}>
      <CardIconButton
        icon="zap"
        accessibilityLabel={
          view.steerBlockedReason ? `Steer now. ${view.steerBlockedReason}` : "Steer now"
        }
        disabled={!view.canSteer}
        onPress={() => onAction({ kind: "steer", submissionId: view.submissionId })}
      />
      <CardIconButton
        icon="pencil"
        accessibilityLabel="Edit queued message"
        disabled={!view.canEdit}
        onPress={() => onAction({ kind: "begin_edit", submissionId: view.submissionId })}
      />
      <CardIconButton
        icon="trash-2"
        accessibilityLabel="Remove queued message"
        disabled={!view.canRemove}
        onPress={() => onAction({ kind: "remove", submissionId: view.submissionId })}
      />
    </View>
  );
}

/** The text and references of a queued message, as in the transcript, with small chips. */
function QueuedMessageInline({
  parts,
  fallback,
}: {
  parts: readonly AgentSessionUserMessagePart[];
  /** The attachment names, for a message without text. */
  fallback: string;
}): ReactNode {
  const inline = parts.filter((part) => part.kind !== "attachment");
  if (inline.length === 0) return fallback;
  return inline.map((part, index) => (
    // Message parts have no ID; the order of a message never changes.
    // react-doctor-disable-next-line react-doctor/no-array-index-as-key
    <Fragment key={index}>{inlinePart(part)}</Fragment>
  ));
}

const inlinePart = (part: AgentSessionUserMessagePart): ReactNode => {
  switch (part.kind) {
    case "text":
      return part.text;
    case "slash_command":
      return `/${part.command.trigger}`;
    case "file_reference":
      return <InlineChip kind="file" label={part.file.name} fileKind={part.file.kind} />;
    case "skill_mention":
      return <InlineChip kind="skill" label={part.skill.name} />;
    case "subagent_reference":
      return <InlineChip kind="subagent" label={part.subagent.name} />;
    case "attachment":
      return null;
  }
};

/** A small reference chip inside a line of text, with the desktop `mx-1` space around it. */
function InlineChip(props: Omit<ReferenceChipProps, "size">): ReactElement {
  return (
    <View style={styles.inlineChip}>
      <ReferenceChip size="compact" {...props} />
    </View>
  );
}

/** A sent attachment of a queued message, as the desktop transcript attachment chip. */
function QueuedAttachmentChip({
  part,
}: {
  part: Extract<AgentSessionUserMessagePart, { kind: "attachment" }>;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.attachmentChip}>
      <Icon
        name={ATTACHMENT_KIND_ICONS[part.attachment.kind]}
        size={16}
        colorValue={theme.desktop.mutedForeground}
      />
      <Text
        variant="footnote"
        numberOfLines={1}
        ellipsizeMode="middle"
        style={styles.attachmentName}
      >
        {part.attachment.name}
      </Text>
    </View>
  );
}

/** The desktop card action: a ghost 24-point square with a muted 14-point icon. */
function CardIconButton({
  icon,
  accessibilityLabel,
  disabled,
  onPress,
}: {
  icon: IconName;
  accessibilityLabel: string;
  disabled: boolean;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <Touchable
      feedback="opacity"
      onPress={onPress}
      disabled={disabled}
      hitSlop={touchSlop(24)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled }}
      style={styles.cardButton}
    >
      <Icon name={icon} size={14} colorValue={theme.desktop.mutedForeground} />
    </Touchable>
  );
}

/**
 * A message that the user edits. On desktop its editor opens below the stack; the phone shows the
 * message here and edits it in a sheet.
 */
function EditingCard({
  view,
  onContinue,
}: {
  view: QueueItemView;
  onContinue: (submissionId: string) => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <View style={styles.editing}>
      <View style={styles.editingRow}>
        <Icon name="pencil" size={14} colorValue={theme.desktop.mutedForeground} />
        <View style={styles.grow}>
          <Text variant="footnote" style={styles.trailingText}>
            Editing queued message
          </Text>
          <Text numberOfLines={1} style={styles.editingText}>
            {view.preview || view.attachmentNames.join(", ")}
          </Text>
        </View>
        <ComposerTextButton
          label="Continue"
          variant="ghost"
          accessibilityLabel="Continue editing queued message"
          onPress={() => onContinue(view.submissionId)}
        />
      </View>
      {view.error ? (
        <Text variant="footnote" selectable style={styles.error}>
          {view.error}
        </Text>
      ) : null}
    </View>
  );
}

/**
 * The paused queue at the top of the composer card, as on desktop: why it waits, and the button
 * that releases it.
 */
export function QueuePauseNotice({
  model,
}: {
  model: AgentChatMessageQueueModel;
}): ReactElement | null {
  const theme = useAppTheme();
  const [resuming, setResuming] = useState(false);
  const [failure, setFailure] = useState<ComposerFailure | null>(null);
  // A double tap must not send Resume twice before the pending state renders.
  const flight = useSingleFlight();
  const pause = model.queue?.pause;
  if (!pause) return null;
  const resume = (): void => {
    void flight.start(async () => {
      setResuming(true);
      setFailure(null);
      await model
        .onAction({ kind: "resume" })
        .catch((cause: Error) => {
          setFailure(
            describeComposerFailure(cause, {
              title: "Could not resume the queue",
              attachmentNames: [],
            }),
          );
        })
        .finally(() => setResuming(false));
    });
  };
  return (
    <View style={styles.pauseHolder}>
      <View style={styles.pause} accessibilityRole="summary">
        <Icon name="pause" size={14} colorValue={theme.desktop.mutedForeground} />
        <Text variant="footnote" style={[styles.grow, styles.pauseText]}>
          <Text variant="footnote" weight="medium" style={styles.pauseTitle}>
            Queue paused.
          </Text>{" "}
          {pause.message}
        </Text>
        <ComposerTextButton
          label="Resume queue"
          icon="play"
          variant="outline"
          command
          busy={resuming}
          onPress={resume}
        />
      </View>
      {failure ? <FailureNotice failure={failure} /> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme, rt) => ({
  grow: { flex: 1, minWidth: 0 },
  // The queue gives up height before the composer card, which keeps the field above the keyboard.
  panel: { flexShrink: 1 },
  failure: { paddingBottom: theme.space.sm },
  // The desktop stack sits 12 points inside the composer edges, and the front card tucks under
  // the composer card.
  stack: { flexShrink: 1, marginHorizontal: theme.space.md, marginBottom: -TUCK },
  cards: { flexShrink: 1 },
  spreadList: { gap: 6 },
  peek: {
    height: 2 * PEEK + 2,
    marginBottom: -(PEEK + 2),
    borderTopLeftRadius: theme.radius.xl,
    borderTopRightRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderBottomWidth: 0,
    borderStyle: "dashed",
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.chatSurface,
  },
  peekDepth: (depth: number) => ({
    transform: [{ scaleX: 1 - DEPTH_SCALE * depth }],
  }),
  // The desktop card: `rounded-xl border border-dashed border-input bg-chat-surface px-3 py-2
  // text-[13px] leading-5 text-muted-foreground shadow-xs`.
  // The gap holds the touch area of the first card action, so it does not cover the card.
  card: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: touchSlop(24),
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.sm,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: theme.desktop.input,
    backgroundColor: theme.desktop.chatSurface,
    boxShadow: theme.shadows.card,
    variants: {
      front: {
        true: { paddingBottom: theme.space.sm + TUCK },
        false: { paddingBottom: theme.space.sm },
      },
    },
  },
  cardContent: { flexDirection: "row", alignItems: "flex-start", gap: theme.space.sm },
  // The glyph stays on the middle of the first text line, which grows with the text size.
  glyph: { height: CARD_LINE_HEIGHT * rt.fontScale, justifyContent: "center" },
  cardText: {
    fontFamily: theme.fonts.sans.regular,
    fontWeight: "400",
    fontSize: 13,
    lineHeight: CARD_LINE_HEIGHT,
    color: theme.desktop.mutedForeground,
  },
  inlineChip: { marginHorizontal: 4, transform: [{ translateY: 4 }] },
  attachments: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 6 },
  attachmentChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    maxWidth: 160,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  attachmentName: { flexShrink: 1, color: theme.desktop.foreground },
  note: { marginTop: 6, color: theme.desktop.warningMuted },
  error: { marginTop: 6, color: theme.desktop.destructive },
  // The trailing count and label sit on the first text line and grow with the text size.
  attachmentCount: { flexDirection: "row", alignItems: "center", gap: 2, minHeight: 20 },
  trailing: { lineHeight: CARD_LINE_HEIGHT },
  trailingText: {
    fontFamily: theme.fonts.sans.medium,
    fontWeight: "500",
    fontSize: 11,
    color: theme.desktop.mutedForeground,
  },
  // The gaps hold the touch areas of the 24-point actions, so a tap on Edit never runs Remove.
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2 * touchSlop(24),
    marginVertical: -2,
  },
  cardButton: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
  },
  editing: {
    gap: theme.space.xs,
    marginBottom: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.chatSurface,
    boxShadow: theme.shadows.raised,
  },
  editingRow: { flexDirection: "row", alignItems: "center", gap: theme.space.sm },
  editingText: {
    fontFamily: theme.fonts.sans.regular,
    fontWeight: "400",
    fontSize: 13,
    lineHeight: 20,
    color: theme.desktop.foreground,
  },
  // The desktop notice: `mx-2 mt-2 rounded-lg bg-muted py-1 pr-1 pl-2.5 text-xs`.
  pauseHolder: {
    gap: theme.space.sm,
    marginHorizontal: theme.space.sm,
    marginTop: theme.space.sm,
  },
  pause: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingVertical: 4,
    paddingLeft: 10,
    paddingRight: 4,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.muted,
  },
  pauseText: { color: theme.desktop.mutedForeground },
  pauseTitle: { color: theme.desktop.foreground },
}));
