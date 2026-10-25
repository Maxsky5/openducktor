import type { AgentMessageTarget, AgentQueuedMessage } from "@openducktor/contracts";
import { useClientConnection } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  type AgentChatComposerDraft,
  draftHasMeaningfulContent,
  userMessagePartsToComposerDraft,
} from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import type { ComposerFailure } from "@openducktor/frontend-core/sessions/composer/composer-failure";
import { type ReactElement, useCallback, useState } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { InPlaceSheet } from "@/ui/in-place-sheet";
import { touchSlop } from "@/theme/tokens";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { KEYBOARD_DISMISS_ON_DRAG } from "@/ui/keyboard-dismiss";
import { ComposerAttachButton } from "./composer-attach-button";
import { ComposerAttachmentStrip } from "./composer-attachment-strip";
import type { AttachmentPickers } from "./composer-attachments";
import { ComposerTextButton, GhostIconButton } from "./composer-controls";
import { ComposerTextField } from "./composer-text-field";
import { FailureNotice } from "./composer-failure-notice";
import { useAttachmentPickers } from "./use-attachment-pickers";
import { useComposerDraftEditor } from "./use-composer-draft-editor";

export type EditingEntry = Extract<AgentQueuedMessage, { state: "editing" }>;

const NO_ERRORS: Readonly<Record<string, string>> = Object.freeze({});

type EditorProps = {
  target: AgentMessageTarget;
  entry: EditingEntry;
  pickers: AttachmentPickers;
  commandsOpen: boolean;
  /** An action on this message runs, so the editor waits. */
  isPending: boolean;
  /** The running action is Save. */
  isSaving: boolean;
  failure: ComposerFailure | null;
  onSave: (draft: AgentChatComposerDraft) => void;
  onCancel: () => void;
  onRemove: () => void;
};

/**
 * A sheet that edits a queued message. Done closes the sheet and keeps the edit open, so the
 * message card offers to continue it. Save, Cancel, and Remove end the edit on the host.
 */
export function QueuedMessageEditorSheet({
  entry,
  onClose,
  ...editor
}: Omit<EditorProps, "entry"> & {
  /** The message to edit, or null while the sheet is closed. */
  entry: EditingEntry | null;
  onClose: () => void;
}): ReactElement {
  return (
    <InPlaceSheet
      visible={entry !== null}
      title="Edit Message"
      onClose={onClose}
      dismissible={!editor.isPending}
      scrolls={false}
      padded={false}
    >
      {entry ? <QueuedMessageEditor key={entry.editId} entry={entry} {...editor} /> : null}
    </InPlaceSheet>
  );
}

/**
 * Edits the text and attachments of a queued message in a card that looks like the composer, as
 * the desktop queued message editor: the attachments, the field, and a bar with the attach
 * control, "Editing queued message", Remove, Cancel, and Save. The unsaved edit lives in the
 * memory of the host connection, so it comes back after navigation, but not after an app restart.
 * Save, Cancel, and Remove clear it once the host takes the action.
 */
function QueuedMessageEditor({
  target,
  entry,
  pickers,
  commandsOpen,
  isPending,
  isSaving,
  failure,
  onSave,
  onCancel,
  onRemove,
}: EditorProps): ReactElement {
  const theme = useAppTheme();
  const editDrafts = useClientConnection().drafts.queuedMessageEdits;
  const { editId } = entry;
  const [draft, setDraft] = useState(
    () => editDrafts.read(target, editId) ?? userMessagePartsToComposerDraft(entry.parts),
  );
  const commitDraft = useCallback(
    (next: AgentChatComposerDraft) => {
      setDraft(next);
      editDrafts.write(target, editId, next);
    },
    [editDrafts, editId, target],
  );
  const editor = useComposerDraftEditor({ draft, commitDraft });
  const attachmentPickers = useAttachmentPickers({
    pickers,
    enabled: commandsOpen && !isPending,
    onAdd: editor.addAttachments,
  });
  const canSave = commandsOpen && !isPending && draftHasMeaningfulContent(draft);
  const supportsAttachments = pickers.unavailableReason === null;

  return (
    <ScrollView
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode={KEYBOARD_DISMISS_ON_DRAG}
    >
      <View style={styles.card} accessibilityLabel="Edit queued message">
        <ComposerAttachmentStrip
          attachments={draft.attachments ?? []}
          errors={NO_ERRORS}
          editable={!isPending}
          onRemove={editor.removeAttachment}
        />
        <ComposerTextField
          layout={editor.layout}
          editable={!isPending}
          placeholder="Edit the queued message"
          accessibilityLabel="Queued message"
          accessibilityHint={null}
          minHeight={120}
          maxHeight={240}
          selectionRequest={editor.selectionRequest}
          onChangeText={editor.changeText}
          onSelectionChange={editor.select}
          onFocusChange={editor.noteFocus}
          autoFocus
        />
        <View style={styles.bar}>
          <View style={styles.barStart}>
            {supportsAttachments ? (
              <ComposerAttachButton
                pickers={pickers}
                picking={attachmentPickers}
                accessibilityLabel="Add attachment to queued message"
              />
            ) : null}
            <View style={styles.editingLabel}>
              <Icon name="pencil" size={14} colorValue={theme.desktop.mutedForeground} />
              <Text variant="footnote" numberOfLines={1} style={styles.muted}>
                Editing queued message
              </Text>
            </View>
          </View>
          <View style={styles.barEnd}>
            <GhostIconButton
              icon="trash-2"
              accessibilityLabel="Remove queued message"
              command
              disabled={isPending || !commandsOpen}
              onPress={onRemove}
            />
            <ComposerTextButton
              label="Cancel"
              variant="ghost"
              command
              disabled={isPending}
              accessibilityLabel="Cancel edit"
              onPress={onCancel}
            />
            <ComposerTextButton
              label="Save"
              icon="check"
              variant="primary"
              command
              busy={isSaving}
              disabled={!canSave}
              onPress={() => onSave(draft)}
            />
          </View>
        </View>
      </View>
      {failure ? <FailureNotice failure={failure} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create((theme) => ({
  content: {
    gap: theme.space.md,
    paddingHorizontal: theme.layout.screenPadding,
    paddingTop: theme.space.sm,
    paddingBottom: theme.space.xxxl,
  },
  // The desktop active composer card: `rounded-xl bg-chat-surface shadow-chat`.
  card: {
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    backgroundColor: theme.desktop.chatSurface,
    boxShadow: theme.shadows.raised,
  },
  // The desktop bar: `flex flex-wrap items-center gap-2 px-2 pb-2 pt-1`.
  bar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.sm,
    paddingBottom: theme.space.sm,
    paddingTop: theme.space.xs,
  },
  barStart: { flexDirection: "row", alignItems: "center", gap: theme.space.xs, flexShrink: 1 },
  editingLabel: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 6,
    flexShrink: 1,
  },
  muted: { flexShrink: 1, color: theme.desktop.mutedForeground },
  // The gaps hold the touch areas of the 32-point buttons, so no touch area covers a neighbor.
  barEnd: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2 * touchSlop(32),
    marginLeft: "auto",
  },
}));
