import type { ComponentProps, ReactElement, ReactNode } from "react";
import { View } from "react-native";
import Animated from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { withAlpha } from "@/theme/color-alpha";
import { touchSlop } from "@/theme/tokens";
import type { useBottomEdgePadding } from "@/ui/keyboard-inset-view";
import { Text } from "@/ui/text";
import { HardwareKeyboardView } from "../../../modules/openducktor-keyboard";
import { ComposerAttachButton } from "./composer-attach-button";
import { ComposerAttachmentStrip } from "./composer-attachment-strip";
import type { AttachmentPickers } from "./composer-attachments";
import type { ComposerCardState } from "./composer-presentation";
import type { ComposerSuggestion, readComposerTrigger } from "./composer-segments";
import { ComposerSuggestionList } from "./composer-suggestion-list";
import { ComposerTextField } from "./composer-text-field";
import type { useAttachmentPickers } from "./use-attachment-pickers";
import type { useComposerDraftEditor } from "./use-composer-draft-editor";
import type { useComposerSuggestions } from "./use-composer-suggestions";

/** The field grows with the text to about six lines, then scrolls. */
const INPUT_MAX_HEIGHT = 156;
/** The desktop composer card corner: `rounded-xl`. */
export const COMPOSER_CARD_RADIUS = 16;

type AttachmentStripProps = ComponentProps<typeof ComposerAttachmentStrip>;

/**
 * Outer keyboard-padded composer container with optional notices and inline trigger suggestions.
 * Suggestions take room above the composer instead of floating over the transcript so Android
 * touches inside the panel do not fall through to selectable transcript text.
 */
export function ComposerDock({
  keyboardPadding,
  notices,
  trigger,
  suggestions,
  supportsSubagentReferences,
  onPickSuggestion,
  children,
}: {
  keyboardPadding: ReturnType<typeof useBottomEdgePadding>;
  notices?: ReactNode;
  trigger: ReturnType<typeof readComposerTrigger>;
  suggestions: ReturnType<typeof useComposerSuggestions>;
  supportsSubagentReferences: boolean;
  onPickSuggestion: (suggestion: ComposerSuggestion) => void;
  children: ReactNode;
}): ReactElement {
  return (
    <Animated.View style={[styles.container, keyboardPadding]}>
      {notices}
      {trigger ? (
        <ComposerSuggestionList
          trigger={trigger}
          suggestions={suggestions}
          supportsSubagentReferences={supportsSubagentReferences}
          onPick={onPickSuggestion}
        />
      ) : null}
      {children}
    </Animated.View>
  );
}

/** Shared composer card with attachment strip, editor field, send notice, and action controls. */
export function ComposerCard({
  cardState,
  header,
  attachments,
  attachmentErrors,
  editable,
  onRemoveAttachment,
  hasSlashAttachmentConflict,
  compact,
  maxHeight,
  focused,
  onHardwareEnter,
  onFocusChange,
  editor,
  placeholder,
  accessibilityHint,
  sendBlockedReason,
  controls,
}: {
  cardState: ComposerCardState;
  header?: ReactNode;
  attachments: AttachmentStripProps["attachments"];
  attachmentErrors: AttachmentStripProps["errors"];
  editable: boolean;
  onRemoveAttachment: AttachmentStripProps["onRemove"];
  hasSlashAttachmentConflict: boolean;
  compact: boolean;
  maxHeight?: number | undefined;
  focused: boolean;
  onHardwareEnter: (event: { nativeEvent: { shift: boolean } }) => void;
  onFocusChange: (focused: boolean) => void;
  editor: Pick<
    ReturnType<typeof useComposerDraftEditor>,
    "layout" | "selectionRequest" | "changeText" | "select"
  >;
  placeholder: string;
  accessibilityHint: string | null;
  sendBlockedReason: string | null;
  controls: ReactNode;
}): ReactElement {
  return (
    <View style={[styles.card, cardStyleOf(cardState)]}>
      {header}
      <ComposerAttachmentStrip
        attachments={attachments}
        errors={attachmentErrors}
        editable={editable}
        onRemove={onRemoveAttachment}
      />
      {hasSlashAttachmentConflict ? (
        <Text variant="footnote" style={styles.conflict}>
          Remove attachments before running a slash command.
        </Text>
      ) : null}
      <View
        style={[
          styles.editor,
          compact && styles.inlineEditor,
          maxHeight !== undefined ? { maxHeight } : null,
        ]}
      >
        <HardwareKeyboardView
          enabled={focused}
          onHardwareEnter={onHardwareEnter}
          style={[styles.field, compact && styles.inlineField]}
        >
          <ComposerTextField
            layout={editor.layout}
            editable={editable}
            placeholder={placeholder}
            accessibilityLabel="Message"
            accessibilityHint={accessibilityHint}
            maxHeight={INPUT_MAX_HEIGHT}
            selectionRequest={editor.selectionRequest}
            onChangeText={editor.changeText}
            onSelectionChange={editor.select}
            onFocusChange={onFocusChange}
          />
        </HardwareKeyboardView>
        <View style={[styles.actions, compact && styles.inlineActions]}>
          {sendBlockedReason ? (
            <Text variant="footnote" style={styles.sendNotice} accessibilityRole="text">
              {sendBlockedReason}
            </Text>
          ) : null}
          {controls}
        </View>
      </View>
    </View>
  );
}

/** The bottom bar of a composer card: attach and model selector on the start, actions on the end. */
export function ComposerControlsBar({
  compact,
  pickers,
  attachmentPickers,
  modelSelector,
  endControls,
}: {
  compact: boolean;
  pickers: AttachmentPickers;
  attachmentPickers: ReturnType<typeof useAttachmentPickers>;
  modelSelector: ReactNode;
  endControls: ReactNode;
}): ReactElement {
  return (
    <View style={[styles.controls, compact && styles.inlineControls]}>
      <View style={[styles.controlsStart, compact && styles.inlineControlsStart]}>
        <ComposerAttachButton pickers={pickers} picking={attachmentPickers} />
        {modelSelector}
      </View>
      <View style={styles.controlsEnd}>{endControls}</View>
    </View>
  );
}

const cardStyleOf = (state: ComposerCardState) => {
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
  // The field gives up height before the controls, so its text scrolls above the keyboard.
  container: {
    flexShrink: 1,
    minHeight: 0,
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.xs,
    backgroundColor: theme.colors.background,
  },
  card: { flexShrink: 1, minHeight: 0 },
  editor: { flexShrink: 1, minHeight: 0 },
  field: { flexShrink: 1, minHeight: 0, minWidth: 0 },
  actions: { flexShrink: 0 },
  // A low window keeps a full scaled input line beside the controls instead of stacking them.
  inlineEditor: { flexDirection: "row", alignItems: "stretch" },
  inlineField: { flex: 1 },
  inlineActions: { flex: 1, minWidth: 0, justifyContent: "flex-end" },
  // The desktop card has no border: its chat surface and shadow set it apart from the transcript.
  // While the session waits for input, it has the warning outline and glow. While input is off,
  // its surface fades.
  cardActive: {
    borderRadius: COMPOSER_CARD_RADIUS,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.chatSurface,
    boxShadow: theme.shadows.raised,
  },
  cardMuted: {
    borderRadius: COMPOSER_CARD_RADIUS,
    borderCurve: "continuous",
    backgroundColor: withAlpha(theme.desktop.chatSurface, 0.6),
  },
  cardWaiting: {
    borderRadius: COMPOSER_CARD_RADIUS,
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
  // Each gap reserves the touch slop of its neighbors without adding visual space.
  // The selector has horizontal padding, so its label stays clear of the attachment target.
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
    // Yoga's positive flex grows but does not shrink; the model yields to the fixed actions.
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: touchSlop(28),
    minHeight: 32,
  },
  inlineControls: {
    flexWrap: "wrap",
    justifyContent: "flex-end",
    rowGap: 2 * touchSlop(32),
    paddingTop: 0,
    paddingBottom: 0,
  },
  inlineControlsStart: { flexBasis: "100%" },
  controlsEnd: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: 2 * touchSlop(32),
  },
}));
