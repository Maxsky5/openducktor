import type { AgentAttachmentKind } from "@openducktor/core";
import type { AgentChatComposerAttachment } from "@openducktor/frontend-core/drafts/agent-chat-composer-draft";
import { Image } from "expo-image";
import { memo, type ReactElement } from "react";
import { View } from "react-native";
// The gesture handler scroll view keeps the keyboard open for a tap on Remove.
import { ScrollView } from "react-native-gesture-handler";
import { StyleSheet } from "react-native-unistyles";
import { pickedFileUri } from "@/platform/device-files";
import { useAppTheme } from "@/theme/app-theme-context";
import { withAlpha } from "@/theme/color-alpha";
import { Icon } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { ATTACHMENT_KIND_ICONS } from "./composer-attachments";

const KIND_LABELS = {
  image: "Image",
  audio: "Audio",
  video: "Video",
  pdf: "PDF",
} satisfies Record<AgentAttachmentKind, string>;

/**
 * The attachments of a draft as the desktop draft attachment chips: an outlined card with a
 * thumbnail for a photo picked on this device, the kind icon and the name, a remove control at the
 * top right, and the problem of the attachment under a divider. The phone shows them in one row
 * that scrolls sideways, so the field keeps its height.
 */
export function ComposerAttachmentStrip({
  attachments,
  errors,
  editable,
  onRemove,
}: {
  attachments: readonly AgentChatComposerAttachment[];
  errors: Readonly<Record<string, string>>;
  editable: boolean;
  onRemove: (attachmentId: string) => void;
}): ReactElement | null {
  if (attachments.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={styles.strip}
      contentContainerStyle={styles.stripContent}
      accessibilityLabel="Attachments"
    >
      {/* A message has few attachments, so the strip renders each one. */}
      {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
      {attachments.map((attachment) => (
        <AttachmentChip
          key={attachment.id}
          attachment={attachment}
          error={errors[attachment.id] ?? null}
          editable={editable}
          onRemove={onRemove}
        />
      ))}
    </ScrollView>
  );
}

const AttachmentChip = memo(function AttachmentChip({
  attachment,
  error,
  editable,
  onRemove,
}: {
  attachment: AgentChatComposerAttachment;
  error: string | null;
  editable: boolean;
  onRemove: (attachmentId: string) => void;
}): ReactElement {
  const theme = useAppTheme();
  const invalid = error !== null;
  styles.useVariants({ invalid });
  // A staged attachment has a host path instead of a device file, so it shows only its name.
  const thumbnail =
    attachment.kind === "image" && attachment.file ? pickedFileUri(attachment.file) : null;
  return (
    <View
      style={[styles.chip, thumbnail ? styles.previewChip : null]}
      accessible
      accessibilityLabel={[`${KIND_LABELS[attachment.kind]} attachment ${attachment.name}`, error]
        .filter(Boolean)
        .join(". ")}
      accessibilityActions={editable ? [{ name: "delete", label: "Remove" }] : []}
      onAccessibilityAction={(event) => {
        if (event.nativeEvent.actionName === "delete") onRemove(attachment.id);
      }}
    >
      {thumbnail ? (
        <View style={styles.thumbnail}>
          <Image
            source={{ uri: thumbnail }}
            recyclingKey={attachment.id}
            contentFit="cover"
            style={styles.image}
            accessible={false}
          />
        </View>
      ) : null}
      <View style={[styles.nameRow, editable && !thumbnail ? styles.nameRowRemovable : null]}>
        <Icon
          name={ATTACHMENT_KIND_ICONS[attachment.kind]}
          size={16}
          colorValue={theme.desktop.mutedForeground}
        />
        <Text variant="footnote" numberOfLines={1} ellipsizeMode="middle" style={styles.name}>
          {attachment.name}
        </Text>
      </View>
      {error ? (
        <Text variant="caption2" numberOfLines={3} selectable style={styles.error}>
          {error}
        </Text>
      ) : null}
      {editable ? (
        <Touchable
          feedback="opacity"
          onPress={() => onRemove(attachment.id)}
          radius={theme.radius.pill}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={`Remove ${attachment.name}`}
          containerStyle={styles.removeArea}
          style={styles.remove}
        >
          <Icon name="x" size={14} colorValue={theme.desktop.mutedForeground} />
        </Touchable>
      ) : null}
    </View>
  );
});

/** The desktop preview chip is `w-40` with an `h-24` thumbnail; the phone keeps that shape smaller. */
const PREVIEW_WIDTH = 136;
const THUMBNAIL_HEIGHT = 80;

const styles = StyleSheet.create((theme) => ({
  // A horizontal ScrollView grows by default and takes height from its siblings.
  strip: { flexGrow: 0 },
  stripContent: {
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingTop: theme.space.md,
  },
  // The desktop chip: `rounded-lg border bg-card`, with a rose outline and wash for a problem.
  chip: {
    alignSelf: "flex-start",
    maxWidth: 220,
    overflow: "hidden",
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    variants: {
      invalid: {
        true: {
          borderColor: theme.desktop.destructive,
          backgroundColor: withAlpha(theme.desktop.destructive, 0.05),
        },
        false: { borderColor: theme.desktop.border, backgroundColor: theme.desktop.card },
      },
    },
  },
  previewChip: { width: PREVIEW_WIDTH },
  thumbnail: { height: THUMBNAIL_HEIGHT, backgroundColor: theme.desktop.muted },
  image: { width: "100%", height: THUMBNAIL_HEIGHT },
  nameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  nameRowRemovable: { paddingRight: 34 },
  name: { flexShrink: 1, color: theme.desktop.foreground },
  error: {
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
    borderTopWidth: 1,
    borderTopColor: withAlpha(theme.desktop.destructive, 0.2),
    fontFamily: theme.fonts.sans.regular,
    fontWeight: "400",
    color: theme.desktop.destructive,
  },
  removeArea: { position: "absolute", top: theme.space.xs, right: theme.space.xs },
  remove: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.pill,
    backgroundColor: withAlpha(theme.desktop.card, 0.9),
  },
}));
