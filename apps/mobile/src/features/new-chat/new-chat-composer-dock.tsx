import type { RuntimeKind } from "@openducktor/contracts";
import type { workspaceSessionValidationError } from "@openducktor/frontend-core/workspace-sessions/create/workspace-session-worktree-rules";
import type { ReactElement } from "react";
import { ScrollView, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { ComposerCard, ComposerControlsBar, ComposerDock } from "@/features/composer/composer-card";
import { QuietSelector, SendButton } from "@/features/composer/composer-controls";
import { RuntimeIcon } from "@/ui/brand-icons";
import { Callout } from "@/ui/callout";
import { Icon } from "@/ui/icon";
import { KEYBOARD_DISMISS_ON_DRAG } from "@/ui/keyboard-dismiss";
import { Text } from "@/ui/text";
import type { NewChatDraftController } from "./use-new-chat-draft-controller";

export function NewChatHeroView({
  workspaceName,
  preSaveError,
  hostValidationError,
}: {
  workspaceName: string;
  preSaveError: Error | null;
  hostValidationError: ReturnType<typeof workspaceSessionValidationError>;
}): ReactElement {
  return (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={styles.heroScroll}
      keyboardDismissMode={KEYBOARD_DISMISS_ON_DRAG}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.hero}>
        <View style={styles.heroIcon}>
          <Icon name="message-circle-plus" size={24} color="secondaryLabel" />
        </View>
        <Text variant="title3" style={styles.heroTitle}>
          Start a new session
        </Text>
        <Text variant="subhead" tone="secondary" style={styles.heroSubtitle}>
          {`Send your first message in ${workspaceName}. Your session is created when you send.`}
        </Text>
        {preSaveError && !hostValidationError ? (
          <Callout
            tone="destructive"
            title="Could not start session"
            message={preSaveError.message}
          />
        ) : null}
      </View>
    </ScrollView>
  );
}

export function NewChatComposerDock({
  composer,
  runtimeKind,
  isReadOnly,
  compact,
  onOpenModelSheet,
  onSend,
}: {
  composer: NewChatDraftController["composer"];
  runtimeKind: RuntimeKind | null;
  isReadOnly: boolean;
  compact: boolean;
  onOpenModelSheet: () => void;
  onSend: () => void;
}): ReactElement {
  return (
    <ComposerDock
      keyboardPadding={composer.keyboardPadding}
      trigger={composer.trigger}
      suggestions={composer.suggestions}
      supportsSubagentReferences={composer.promptInput.support.supportsSubagentReferences}
      onPickSuggestion={composer.pickSuggestion}
    >
      <ComposerCard
        cardState={composer.cardState}
        attachments={composer.draft.attachments ?? []}
        attachmentErrors={composer.policy.attachmentErrors}
        editable={!composer.policy.isComposerInputDisabled}
        onRemoveAttachment={composer.editor.removeAttachment}
        hasSlashAttachmentConflict={composer.policy.hasSlashAttachmentConflict}
        compact={compact}
        focused={composer.focused}
        onHardwareEnter={composer.onHardwareEnter}
        onFocusChange={composer.onFocusChange}
        editor={composer.editor}
        placeholder={composer.fieldText.placeholder}
        accessibilityHint={composer.fieldText.hint}
        sendBlockedReason={composer.policy.sendBlockedReason}
        controls={
          <ComposerControlsBar
            compact={compact}
            pickers={composer.pickers}
            attachmentPickers={composer.attachmentPickers}
            modelSelector={
              <QuietSelector
                leading={
                  runtimeKind ? (
                    <RuntimeIcon runtimeKind={runtimeKind} size={16} />
                  ) : (
                    <Icon name="cpu" size={16} color="secondaryLabel" />
                  )
                }
                profile={composer.modelDisplay.profile}
                label={composer.modelDisplay.label}
                detail={composer.modelDisplay.effort}
                speedTone={composer.modelDisplay.speedTone}
                accessibilityLabel={composer.modelDisplay.accessibilityLabel}
                accessibilityHint="Opens the model, profile, effort, and speed."
                disabled={isReadOnly}
                onPress={onOpenModelSheet}
              />
            }
            endControls={
              <SendButton
                enabled={composer.sendState === "ready"}
                busy={composer.sendState === "busy"}
                label="Send message"
                hint={composer.policy.sendBlockedReason}
                pendingCount={0}
                pendingLabel={null}
                onPress={onSend}
              />
            }
          />
        }
      />
    </ComposerDock>
  );
}

export function SubmittedMessagePreview({
  text,
  attachmentCount,
}: {
  text: string;
  attachmentCount: number;
}): ReactElement | null {
  if (!text.trim() && attachmentCount === 0) return null;
  return (
    <View style={styles.submittedWrap}>
      <View style={styles.submittedBubble}>
        {text.trim().length > 0 ? (
          <Text variant="body" selectable style={styles.submittedText}>
            {text}
          </Text>
        ) : null}
        {attachmentCount > 0 ? (
          <Text variant="caption1" tone="secondary">
            {`${attachmentCount} attachment${attachmentCount === 1 ? "" : "s"}`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  fill: { flex: 1 },
  heroScroll: {
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: theme.layout.screenPadding,
    paddingVertical: theme.space.xl,
  },
  hero: {
    alignItems: "center",
    gap: theme.space.sm,
    maxWidth: 420,
    alignSelf: "center",
    width: "100%",
  },
  heroIcon: {
    width: 48,
    height: 48,
    borderRadius: theme.radius.xl,
    backgroundColor: theme.colors.fill,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: theme.space.xs,
  },
  heroTitle: { textAlign: "center" },
  heroSubtitle: { textAlign: "center" },
  submittedWrap: { alignItems: "flex-end" },
  submittedBubble: {
    maxWidth: "88%",
    gap: theme.space.xs,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderRadius: theme.radius.xl,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
  },
  submittedText: { color: theme.desktop.foreground },
}));
