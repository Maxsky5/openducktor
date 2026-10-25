import { memo, type ReactElement } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { haptics } from "./haptics";
import { Icon } from "./icon";
import { Text } from "./text";
import { Touchable } from "./touchable";

/**
 * One option of a long single-choice list, as the desktop combobox options: the label with an
 * optional description under it, and a violet check on the chosen option, which also has the
 * desktop accent fill. Code names, such as branches, use the code font and keep both ends.
 */
export const PickerRow = memo(function PickerRow({
  id,
  title,
  subtitle,
  mono = false,
  selected,
  disabled = false,
  onSelect,
}: {
  id: string;
  title: string;
  subtitle?: string | null | undefined;
  mono?: boolean | undefined;
  selected: boolean;
  disabled?: boolean | undefined;
  onSelect: (id: string) => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <Touchable
      feedback="highlight"
      onPress={() => {
        haptics.selection();
        onSelect(id);
      }}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={{ selected, disabled }}
      style={[styles.row, selected && styles.selectedRow]}
    >
      <View style={styles.body}>
        <Text
          variant={mono ? "mono" : "body"}
          weight={selected ? "semibold" : "regular"}
          numberOfLines={1}
          ellipsizeMode={mono ? "middle" : "tail"}
          style={mono ? styles.mono : null}
        >
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone="tertiary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {/* Android draws a transparent glyph color as black, so an unselected row keeps only the
          space of the check. */}
      {selected ? (
        <Icon name="check" size={CHECK_SIZE} colorValue={theme.colors.tint} />
      ) : (
        <View style={styles.checkSpace} />
      )}
    </Touchable>
  );
});

const CHECK_SIZE = 18;

const styles = StyleSheet.create((theme) => ({
  checkSpace: { width: CHECK_SIZE, height: CHECK_SIZE },
  row: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.layout.screenPadding,
    paddingVertical: 10,
  },
  selectedRow: { backgroundColor: theme.desktop.accent },
  body: { flex: 1, gap: 2, minWidth: 0 },
  mono: { fontSize: 14, lineHeight: 20 },
}));
