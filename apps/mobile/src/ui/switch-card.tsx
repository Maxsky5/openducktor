import type { ReactElement, ReactNode } from "react";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { SwitchRow } from "./fields";

/**
 * A switch row in an outlined card, with the details of the choice under it, as the desktop
 * `SwitchCard`.
 */
export function SwitchCard({
  label,
  value,
  onValueChange,
  disabled,
  children,
}: {
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean | undefined;
  children?: ReactNode;
}): ReactElement {
  return (
    <View style={styles.card}>
      <SwitchRow label={label} value={value} onValueChange={onValueChange} disabled={disabled} />
      {children ? <View style={styles.details}>{children}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  card: {
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    overflow: "hidden",
  },
  details: {
    gap: theme.space.sm,
    paddingHorizontal: theme.space.md,
    paddingBottom: theme.space.md,
  },
}));
