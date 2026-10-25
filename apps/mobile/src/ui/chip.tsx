import type { ReactElement } from "react";
import { StyleSheet } from "react-native-unistyles";
import { verticalTouchSlop } from "@/theme/tokens";
import { haptics } from "./haptics";
import { Icon } from "./icon";
import { Text } from "./text";
import { Touchable } from "./touchable";

const CHIP_HEIGHT = 32;
const CHIP_SLOP = verticalTouchSlop(CHIP_HEIGHT);

/** A toggle chip for a filter or a multiple choice. A check mark shows the selected state. */
export function Chip({
  label,
  accessibilityLabel,
  selected,
  onPress,
  disabled = false,
}: {
  label: string;
  accessibilityLabel?: string | undefined;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean | undefined;
}): ReactElement {
  styles.useVariants({ selected });
  return (
    <Touchable
      feedback="scale"
      onPress={() => {
        haptics.selection();
        onPress();
      }}
      disabled={disabled}
      radius={999}
      hitSlop={CHIP_SLOP}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ checked: selected, disabled }}
      style={styles.chip}
    >
      {selected ? <Icon name="check" size={14} color="tint" /> : null}
      <Text variant="subhead" weight="medium" numberOfLines={1} style={styles.label}>
        {label}
      </Text>
    </Touchable>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    minHeight: CHIP_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 12,
    borderWidth: 1,
    variants: {
      selected: {
        true: { backgroundColor: theme.colors.tintSoft, borderColor: theme.colors.tintBorder },
        false: { backgroundColor: theme.colors.surface, borderColor: theme.colors.border },
      },
    },
  },
  label: {
    variants: {
      selected: {
        true: { color: theme.colors.tint },
        false: { color: theme.colors.label },
      },
    },
  },
}));
