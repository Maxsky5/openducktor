import type { AgentAttachmentKind } from "@openducktor/core";
import {
  isPreviewableAttachmentKind,
  toTranscriptAttachment,
} from "@openducktor/frontend-core/drafts/agent-chat-attachments";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { UserAttachmentPart } from "@openducktor/frontend-core/sessions/messages/agent-chat-user-message-content";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { memo, type ReactElement, useMemo } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useActiveSession } from "@/host-session/active-session-context";
import { resourceFileQueryOptions } from "@/platform/resource-files";
import { useResourceFiles } from "@/platform/resource-files-context";
import { useImageActions } from "@/rich-content/images/use-image-actions";
import { useAppTheme } from "@/theme/app-theme-context";
import { sansWeight } from "@/theme/tokens";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Icon, type IconName } from "@/ui/icon";
import { Text } from "@/ui/text";
import { Touchable } from "@/ui/touchable";
import { useTranscriptRows } from "../transcript-rows-context";
import { useRowVisible } from "../transcript-visibility";

/** The desktop `ATTACHMENT_ICON` of each attachment kind. */
const KIND_ICONS = {
  image: "image",
  audio: "file-audio-2",
  video: "film",
  pdf: "file-text",
} satisfies Record<AgentAttachmentKind, IconName>;

const KIND_LABELS = {
  image: "Image",
  audio: "Audio",
  video: "Video",
  pdf: "PDF",
} satisfies Record<AgentAttachmentKind, string>;

/**
 * The desktop transcript attachment chip: a card 128 wide with an image thumbnail from the host
 * while the row is in view, and the file icon and name under it. A tap on the thumbnail opens the
 * image. Other files show only the icon and name.
 */
export const AttachmentPreview = memo(function AttachmentPreview({
  part,
  rowKey,
}: {
  part: UserAttachmentPart;
  rowKey: string;
}): ReactElement {
  const theme = useAppTheme();
  const attachment = toTranscriptAttachment(part.attachment);
  const previewable =
    attachment.kind === "image" &&
    isPreviewableAttachmentKind(attachment.kind) &&
    attachment.localPreviewAvailable !== false &&
    attachment.path.trim().length > 0;
  const label = `${KIND_LABELS[attachment.kind]} attachment ${attachment.name}`;
  return (
    <View
      style={styles.chip}
      // A preview is its own control, so screen readers reach it inside the chip.
      accessible={!previewable}
      accessibilityRole="text"
      accessibilityLabel={label}
    >
      {previewable ? (
        <View style={styles.thumbnail}>
          <StagedImage
            path={attachment.path}
            name={attachment.name}
            label={label}
            mediaType={attachment.mime}
            rowKey={rowKey}
          />
        </View>
      ) : null}
      <View style={styles.name}>
        <Icon
          name={KIND_ICONS[attachment.kind]}
          size={16}
          colorValue={theme.desktop.mutedForeground}
        />
        <Text numberOfLines={1} ellipsizeMode="middle" style={styles.nameText}>
          {attachment.name}
        </Text>
      </View>
    </View>
  );
});

type StagedImageProps = {
  path: string;
  name: string;
  /** The spoken name of the attachment. */
  label: string;
  mediaType: string | undefined;
};

function StagedImage({
  rowKey,
  ...image
}: StagedImageProps & { rowKey: string }): ReactElement | null {
  const { visibleRows } = useTranscriptRows();
  const visible = useRowVisible(visibleRows, rowKey);
  // A few rows away from the viewport, the read unmounts, so its device file goes away. The frame
  // keeps its size.
  return visible ? <StagedImageRead {...image} /> : null;
}

/**
 * The image preview from the host. A tap opens the share sheet, which previews the full image and
 * saves it, as a tap on a generated image does.
 */
function StagedImageRead({ path, name, label, mediaType }: StagedImageProps): ReactElement {
  const theme = useAppTheme();
  const { action, share } = useImageActions();
  const { remote } = useActiveSession().remote;
  const files = useResourceFiles();
  const options = useMemo(
    () =>
      resourceFileQueryOptions(files, ["staged-preview", path], (signal) =>
        remote.readStagedPreview(path, signal),
      ),
    [files, path, remote],
  );
  const query = useQuery(options);
  const source = useMemo(() => (query.data ? { uri: query.data.uri } : null), [query.data]);
  if (query.isError) {
    return (
      <View style={styles.unavailable}>
        <Text numberOfLines={4} selectable style={styles.unavailableText}>
          {`Preview unavailable. ${errorMessage(query.error)}`}
        </Text>
      </View>
    );
  }
  if (!source) {
    return (
      <View style={styles.loading}>
        <LoaderSpinner size={16} color={theme.desktop.mutedForeground} />
      </View>
    );
  }
  return (
    <Touchable
      feedback="opacity"
      disabled={action !== null}
      onPress={() => void share(source.uri, name, mediaType)}
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      accessibilityHint="Opens the share sheet to preview or save the image."
      containerStyle={styles.image}
      style={styles.image}
    >
      <Image
        source={source}
        recyclingKey={path}
        contentFit="cover"
        cachePolicy="memory"
        transition={120}
        style={styles.image}
      />
    </Touchable>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The desktop chip: `w-32 rounded-lg border border-border bg-card`.
  chip: {
    width: 128,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.desktop.card,
    overflow: "hidden",
  },
  // The desktop thumbnail: `h-24 bg-muted`.
  thumbnail: { height: 96, backgroundColor: theme.desktop.muted },
  image: { width: "100%", height: "100%" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  unavailable: { flex: 1, alignItems: "center", justifyContent: "center", padding: theme.space.sm },
  unavailableText: {
    ...sansWeight("regular"),
    fontSize: 11,
    lineHeight: 14,
    textAlign: "center",
    color: theme.desktop.mutedForeground,
  },
  // The desktop name row: `flex items-center gap-2 px-3 py-2`.
  name: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingVertical: theme.space.sm,
  },
  nameText: {
    ...sansWeight("regular"),
    flex: 1,
    fontSize: 12.5,
    lineHeight: 17,
    color: theme.desktop.foreground,
  },
}));
