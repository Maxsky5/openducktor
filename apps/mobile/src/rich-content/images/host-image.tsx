import { type TaskAssetRenderContext, taskAssetRenderContextSchema } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { useQuery } from "@tanstack/react-query";
import { memo, type ReactElement, useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { sansWeight } from "@/theme/tokens";
import { useActiveSession } from "@/host-session/active-session-context";
import { resourceFileQueryOptions } from "@/platform/resource-files";
import { useResourceFiles } from "@/platform/resource-files-context";
import { Button } from "@/ui/button";
import { Callout } from "@/ui/callout";
import { FittedImage } from "./fitted-image";
import { knownAspectRatio, MAX_IMAGE_HEIGHT } from "./image-aspect-ratio";
import type { TaskImageContext } from "./image-source";

export type HostImageProps = {
  /** The asset ID of an `odt-asset:<assetId>` reference. */
  assetId: string;
  context: TaskImageContext;
  alt: string;
  /**
   * False while the image is away from the list viewport. The image and its read then unmount,
   * so the device file goes away, and a placeholder keeps the image height.
   */
  visible?: boolean | undefined;
  /** Opens the loaded image file, such as in the share sheet. Without it, the image is not a control. */
  onPress?: ((file: HostImageFile) => void) | undefined;
  /** Says what a press does, such as "Opens the share sheet." */
  accessibilityHint?: string | undefined;
};

/** The device cache file of a loaded task image. It exists while the image view is mounted. */
export type HostImageFile = { readonly uri: string; readonly mediaType: string };

/**
 * A task description image from the host. The host bytes go to a device cache file, never to
 * JavaScript memory. The file goes away when the last view of the image unmounts.
 */
export const HostImage = memo(function HostImage({
  assetId,
  context,
  alt,
  visible = true,
  onPress,
  accessibilityHint,
}: HostImageProps): ReactElement {
  const { workspaceId, taskId } = context;
  const renderContext = useMemo(() => {
    const parsed = taskAssetRenderContextSchema.safeParse({
      workspaceId,
      taskId,
      scope: "description",
      assetId,
    });
    return parsed.success ? parsed.data : null;
  }, [assetId, taskId, workspaceId]);
  if (renderContext === null) {
    return (
      <Callout
        tone="warning"
        title="The image did not show."
        message="The task image reference is not valid."
      />
    );
  }
  return visible ? (
    <LoadedHostImage
      renderContext={renderContext}
      alt={alt}
      onPress={onPress}
      accessibilityHint={accessibilityHint}
    />
  ) : (
    <ImagePlaceholder alt={alt} loading={false} recyclingKey={assetId} />
  );
});

/** The mounted read of one task image. Unmounting it ends the read and removes its device file. */
function LoadedHostImage({
  renderContext,
  alt,
  onPress,
  accessibilityHint,
}: {
  renderContext: TaskAssetRenderContext;
  alt: string;
  onPress: ((file: HostImageFile) => void) | undefined;
  accessibilityHint: string | undefined;
}): ReactElement {
  const { remote } = useActiveSession().remote;
  const files = useResourceFiles();
  // The first connection generation of this view keys the read, so a reconnect does not read again.
  const [generation] = useState(() => remote.readState().generation);
  const { workspaceId, taskId, assetId } = renderContext;
  const options = useMemo(
    () =>
      resourceFileQueryOptions(
        files,
        ["task-asset", workspaceId, taskId, assetId],
        generation,
        (signal) => remote.readTaskAsset(renderContext, signal),
      ),
    [assetId, files, generation, remote, renderContext, taskId, workspaceId],
  );
  const query = useQuery(options);
  const file = query.data;
  const press = useCallback(() => {
    if (file !== undefined && onPress !== undefined) onPress(file);
  }, [file, onPress]);
  if (query.isError) {
    return (
      <Callout
        tone="destructive"
        title="The image did not load."
        message={errorMessage(query.error)}
        action={
          <Button label="Try Again" size="sm" variant="gray" onPress={() => void query.refetch()} />
        }
      />
    );
  }
  if (query.data === undefined) {
    return <ImagePlaceholder alt={alt} loading recyclingKey={assetId} />;
  }
  if (!query.data.mediaType.startsWith("image/")) {
    return (
      <Callout
        tone="destructive"
        title="The image did not show."
        message={`The host sent a ${query.data.mediaType} file, not an image.`}
      />
    );
  }
  return (
    <FittedImage
      uri={query.data.uri}
      recyclingKey={assetId}
      alt={alt}
      cachePolicy="none"
      onPress={onPress === undefined ? undefined : press}
      accessibilityHint={accessibilityHint}
    />
  );
}

/**
 * The space of an image that has not loaded, as the desktop task image placeholder: an outlined
 * `bg-muted/30` box with "Loading image…". An image that showed before keeps its height.
 */
export function ImagePlaceholder({
  alt,
  loading,
  recyclingKey,
}: {
  alt: string;
  loading: boolean;
  /** The `FittedImage` key of the image, so its known aspect ratio sizes the placeholder. */
  recyclingKey?: string | undefined;
}): ReactElement {
  const ratio = recyclingKey === undefined ? undefined : knownAspectRatio(recyclingKey);
  return (
    <View
      style={ratio === undefined ? styles.placeholder : [styles.placeholder, styles.sized(ratio)]}
      accessible
      accessibilityLabel={alt.length > 0 ? alt : "Image"}
      accessibilityState={{ busy: loading }}
    >
      {loading ? (
        <Text style={styles.loading} accessibilityElementsHidden>
          Loading image…
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  placeholder: {
    height: 180,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    backgroundColor: theme.colors.insetFill,
  },
  loading: {
    ...sansWeight("regular"),
    fontSize: 14,
    lineHeight: 20,
    color: theme.desktop.mutedForeground,
  },
  sized: (aspectRatio: number) => ({
    height: undefined,
    width: "100%",
    aspectRatio,
    maxHeight: MAX_IMAGE_HEIGHT,
  }),
}));
