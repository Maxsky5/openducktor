import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/ui/button";
import { FittedImage } from "./fitted-image";
import { useImageActions } from "./use-image-actions";

export type ShareableImageProps = {
  /** A local file URI, such as a generated image in the device cache. */
  uri: string;
  /** A stable name of the image. Its known aspect ratio keeps the placeholder height. */
  recyclingKey: string;
  alt: string;
  /** The image media type, such as `image/png`. Share targets use it to name the file type. */
  mediaType?: string | undefined;
};

/**
 * An image with Share and Copy actions. A tap on the image opens the share sheet, which also
 * previews and saves it. The image bytes enter JavaScript only for a copy.
 */
export const ShareableImage = memo(function ShareableImage({
  uri,
  recyclingKey,
  alt,
  mediaType,
}: ShareableImageProps): ReactElement {
  const { action, share, copy } = useImageActions();
  const busy = action !== null;
  const shareImage = (): void => {
    if (!busy) void share(uri, alt, mediaType);
  };
  return (
    <View style={styles.container}>
      <FittedImage
        uri={uri}
        recyclingKey={recyclingKey}
        alt={alt}
        cachePolicy="memory"
        onPress={shareImage}
        accessibilityHint="Opens the share sheet."
      />
      <View style={styles.actions}>
        <Button
          label="Share"
          icon="share"
          size="sm"
          variant="gray"
          loading={action === "share"}
          disabled={busy}
          accessibilityLabel="Share image"
          onPress={shareImage}
        />
        <Button
          label="Copy"
          icon="copy"
          size="sm"
          variant="gray"
          loading={action === "copy"}
          disabled={busy}
          accessibilityLabel="Copy image"
          onPress={() => void copy(uri)}
        />
      </View>
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  container: { gap: theme.space.sm },
  actions: { flexDirection: "row", gap: theme.space.sm },
}));
