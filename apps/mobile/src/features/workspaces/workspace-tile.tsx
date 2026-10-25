import { graphemesOf } from "@openducktor/frontend-core/workspaces/workspace-tile-appearance";
import { Image } from "expo-image";
import { memo, type ReactElement, useState } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { sansWeight } from "@/theme/tokens";
import { Text } from "@/ui/text";
import { type WorkspaceTileSource, workspaceTileFace } from "./workspace-tile-face";
import { TILE_SIZES } from "./workspace-tile-sizes";

/**
 * The workspace face of the desktop rail: its image, or its abbreviation on the color that the
 * user picked. A tile without a color is neutral, and the selected workspace takes the sidebar
 * accent, as the desktop marks the active workspace, so the brand violet stays unique. It is
 * decorative; the row or control around it carries the workspace name.
 */
export const WorkspaceTile = memo(function WorkspaceTile({
  workspace,
  size = "md",
  active = false,
}: {
  workspace: WorkspaceTileSource;
  size?: keyof typeof TILE_SIZES;
  /** True for the workspace that this app shows, as the active tile of the desktop rail. */
  active?: boolean;
}): ReactElement {
  const face = workspaceTileFace(workspace);
  const [failedIcon, setFailedIcon] = useState<string | null>(null);
  // A three-letter abbreviation takes the smaller desktop label size, so it fits without a cut.
  const long = graphemesOf(face.label).length >= 3;
  styles.useVariants({ size, active, long });
  const dimension = TILE_SIZES[size];
  const showIcon = face.iconDataUrl !== null && failedIcon !== face.iconDataUrl;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[styles.tile, face.colors && { backgroundColor: face.colors.background }]}
    >
      {showIcon && face.iconDataUrl ? (
        <Image
          source={{ uri: face.iconDataUrl }}
          style={[styles.image, { width: dimension * 0.6, height: dimension * 0.6 }]}
          contentFit="cover"
          onError={() => setFailedIcon(face.iconDataUrl)}
        />
      ) : (
        <Text
          numberOfLines={1}
          allowFontScaling={false}
          style={[styles.label, face.colors && { color: face.colors.foreground }]}
        >
          {face.label}
        </Text>
      )}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  tile: {
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    borderCurve: "continuous",
    boxShadow: theme.shadows.card,
    variants: {
      size: {
        xs: { width: TILE_SIZES.xs, height: TILE_SIZES.xs, borderRadius: 5 },
        sm: { width: TILE_SIZES.sm, height: TILE_SIZES.sm, borderRadius: theme.radius.sm },
        md: { width: TILE_SIZES.md, height: TILE_SIZES.md, borderRadius: theme.radius.sm },
        lg: { width: TILE_SIZES.lg, height: TILE_SIZES.lg, borderRadius: theme.radius.sm },
      },
      active: {
        // `bg-sidebar-accent` marks the active tile; other tiles use `bg-workspace-rail-tile`,
        // which is the card color in light mode and the muted color in dark mode.
        true: { backgroundColor: theme.desktop.sidebarAccent },
        false: {
          backgroundColor: theme.scheme === "dark" ? theme.desktop.muted : theme.desktop.card,
        },
      },
      long: { true: {}, false: {} },
    },
  },
  image: { borderRadius: 4 },
  label: {
    ...sansWeight("semibold"),
    variants: {
      active: {
        true: { color: theme.desktop.sidebarAccentForeground },
        false: { color: theme.desktop.foreground },
      },
      size: {
        xs: { fontSize: 8, lineHeight: 10 },
        sm: { fontSize: 11, lineHeight: 14 },
        md: { fontSize: 12, lineHeight: 15 },
        lg: { fontSize: 12, lineHeight: 15 },
      },
      long: {
        true: { fontSize: 10, lineHeight: 13 },
        false: {},
      },
    },
    compoundVariants: [{ size: "xs", long: true, styles: { fontSize: 7, lineHeight: 9 } }],
  },
}));
