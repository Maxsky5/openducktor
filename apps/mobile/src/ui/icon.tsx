import { memo, type ReactElement } from "react";
import { type StyleProp, Text, type TextStyle } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { ThemeColorName } from "@/theme/tokens";
import { ICONS, type IconName } from "./icon-names";
import { LUCIDE_GLYPHS } from "./lucide-glyphs";

export type { IconName } from "./icon-names";

export type IconProps = {
  name: IconName;
  size?: number | undefined;
  /** A theme color name. */
  color?: ThemeColorName | undefined;
  /** An explicit color, such as a status accent. */
  colorValue?: string | undefined;
  /**
   * A theme style with the color, such as a tone style of the parent. A theme change then updates
   * the icon without a render.
   */
  colorStyle?: StyleProp<TextStyle>;
};

/**
 * A decorative Lucide icon, as on desktop. It is a glyph of the embedded Lucide font, so it costs
 * one text view and shows in the first frame. The control around it carries the accessible name.
 * It reads the theme only through its style, so an icon adds no theme listener of its own.
 */
export const Icon = memo(function Icon({
  name,
  size = 20,
  color = "label",
  colorValue,
  colorStyle,
}: IconProps): ReactElement {
  return (
    <Text
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      allowFontScaling={false}
      style={[
        styles.glyph,
        boxOf(size),
        colorStyle ?? (colorValue === undefined ? tintOf(color) : { color: colorValue }),
      ]}
    >
      {LUCIDE_GLYPHS[ICONS[name]]}
    </Text>
  );
});

const boxes = new Map<number, TextStyle>();
/** One box style for each icon size, so an icon in a list row adds no style object per render. */
const boxOf = (size: number): TextStyle => {
  let box = boxes.get(size);
  if (!box) {
    box = { fontSize: size, lineHeight: size, width: size, height: size };
    boxes.set(size, box);
  }
  return box;
};

/** Most icons take the label color, so it has a plain entry: a style function runs native code. */
const tintOf = (color: ThemeColorName) => (color === "label" ? styles.label : styles.tint(color));

const styles = StyleSheet.create((theme) => ({
  glyph: {
    fontFamily: theme.fonts.icons,
    textAlign: "center",
    includeFontPadding: false,
    textAlignVertical: "center",
  },
  label: { color: theme.colors.label },
  tint: (color: ThemeColorName) => ({ color: theme.colors[color] }),
}));
