import type { ReactElement } from "react";
import { Platform, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Text } from "@/ui/text";

/**
 * A navigation bar title with a second line, such as a file name over its directory. Use it as
 * the `headerTitle` of a work view. iOS centers the two lines; Android aligns them at the start.
 */
export function WorkHeaderTitle({
  title,
  subtitle,
  subtitleEllipsis = "middle",
}: {
  title: string;
  subtitle: string | null;
  /** `middle` keeps both ends of a path; `tail` keeps the start of a title. */
  subtitleEllipsis?: "middle" | "tail" | undefined;
}): ReactElement {
  return (
    <View
      style={styles.box}
      accessible
      accessibilityRole="header"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
    >
      <Text style={styles.title} numberOfLines={1} ellipsizeMode="middle">
        {title}
      </Text>
      {subtitle ? (
        <Text
          variant="caption1"
          tone="secondary"
          numberOfLines={1}
          ellipsizeMode={subtitleEllipsis}
          style={styles.subtitle}
        >
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: {
    maxWidth: 260,
    alignItems: Platform.select({ ios: "center", default: "flex-start" }),
  },
  title: Platform.select({
    ios: theme.type.headline,
    default: theme.type.title3,
  }),
  subtitle: { textAlign: Platform.select({ ios: "center", default: "left" }) },
}));
