import type { ReactElement } from "react";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { touchSlop } from "@/theme/tokens";
import { Icon, type IconName } from "@/ui/icon";
import { LoaderSpinner } from "@/ui/loader-spinner";
import { Touchable } from "@/ui/touchable";

/**
 * The desktop card action: a ghost 24-point square with a muted 14-point icon. A pending action
 * shows a spinner in place of its icon.
 */
export function CardIconButton({
  icon,
  accessibilityLabel,
  disabled,
  pending = false,
  onPress,
}: {
  icon: IconName;
  accessibilityLabel: string;
  disabled: boolean;
  pending?: boolean;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  return (
    <Touchable
      feedback="opacity"
      onPress={onPress}
      disabled={disabled}
      hitSlop={touchSlop(24)}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, busy: pending }}
      style={styles.cardButton}
    >
      {pending ? (
        <LoaderSpinner size={14} color={theme.desktop.mutedForeground} />
      ) : (
        <Icon name={icon} size={14} colorValue={theme.desktop.mutedForeground} />
      )}
    </Touchable>
  );
}

const styles = StyleSheet.create((theme) => ({
  cardButton: {
    width: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
  },
}));
