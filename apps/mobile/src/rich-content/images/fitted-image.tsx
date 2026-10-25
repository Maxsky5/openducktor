import { Image, type ImageLoadEventData, type ImageTransition } from "expo-image";
import { memo, type ReactElement, useCallback, useMemo, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Callout } from "@/ui/callout";
import { Touchable } from "@/ui/touchable";
import { knownAspectRatio, MAX_IMAGE_HEIGHT, rememberAspectRatio } from "./image-aspect-ratio";

const DEFAULT_ASPECT_RATIO = 16 / 9;

/**
 * A short cross-fade from the placeholder wash to the decoded image. An image that comes back
 * from the memory cache, such as a row that scrolls back into view, shows at once.
 */
const IMAGE_TRANSITION: ImageTransition = {
  duration: 150,
  effect: "cross-dissolve",
  skipOnCacheHit: "memory",
};

export type FittedImageProps = {
  uri: string;
  /** Names the image. A recycled list row shows no old image while the new one loads. */
  recyclingKey: string;
  alt: string;
  /** `none` for device cache files, `disk` for web images. No policy keeps decoded images in JS memory. */
  cachePolicy: "none" | "disk";
  /** Opens the image, such as in the share sheet or the browser. Without it, the image is not a control. */
  onPress?: (() => void) | undefined;
  /** Says what a press does, such as "Opens the share sheet." */
  accessibilityHint?: string | undefined;
};

/**
 * An image at the full content width with its own aspect ratio. A wash of the known aspect
 * ratio holds its place while it loads. expo-image decodes it at the display size, and the
 * native view releases it when the row unmounts.
 */
export const FittedImage = memo(function FittedImage({
  uri,
  recyclingKey,
  alt,
  cachePolicy,
  onPress,
  accessibilityHint,
}: FittedImageProps): ReactElement {
  const theme = useAppTheme();
  const [loaded, setLoaded] = useState<{ key: string; ratio: number } | null>(null);
  const [failure, setFailure] = useState<{ key: string; message: string } | null>(null);
  const ratio =
    loaded?.key === recyclingKey
      ? loaded.ratio
      : (knownAspectRatio(recyclingKey) ?? DEFAULT_ASPECT_RATIO);
  const sizeStyle = useMemo(() => ({ aspectRatio: ratio }), [ratio]);
  const source = useMemo(() => ({ uri }), [uri]);
  const onLoad = useCallback(
    (event: ImageLoadEventData) => {
      const { width, height } = event.source;
      if (width <= 0 || height <= 0) return;
      rememberAspectRatio(recyclingKey, width / height);
      setLoaded({ key: recyclingKey, ratio: width / height });
    },
    [recyclingKey],
  );
  const onError = useCallback(
    (event: { error: string }) => setFailure({ key: recyclingKey, message: event.error }),
    [recyclingKey],
  );

  if (failure?.key === recyclingKey) {
    return <Callout tone="destructive" title="The image did not show." message={failure.message} />;
  }
  const label = alt.length > 0 ? alt : "Image";
  const image = (
    <Image
      source={source}
      recyclingKey={recyclingKey}
      contentFit="contain"
      cachePolicy={cachePolicy}
      transition={IMAGE_TRANSITION}
      accessible={onPress === undefined}
      accessibilityLabel={label}
      style={[styles.image, sizeStyle]}
      onLoad={onLoad}
      onError={onError}
    />
  );
  if (onPress === undefined) return <View style={styles.frame}>{image}</View>;
  return (
    <Touchable
      feedback="scale"
      onPress={onPress}
      radius={theme.radius.lg}
      accessibilityRole="imagebutton"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      containerStyle={styles.pressable}
      style={styles.frame}
    >
      {image}
    </Touchable>
  );
});

const styles = StyleSheet.create((theme) => ({
  pressable: { alignSelf: "stretch" },
  frame: {
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    overflow: "hidden",
    backgroundColor: theme.colors.insetFill,
    alignSelf: "stretch",
  },
  image: { width: "100%", maxHeight: MAX_IMAGE_HEIGHT },
}));
