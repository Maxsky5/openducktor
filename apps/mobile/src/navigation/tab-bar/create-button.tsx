import type { ReactElement } from "react";
import { type Insets, View } from "react-native";
import Animated, { interpolate, type SharedValue, useAnimatedStyle } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { Icon } from "@/ui/icon";
import { Touchable } from "@/ui/touchable";
import { TAB_BAR } from "./tab-bar-geometry";

/**
 * The create button of the tab bar and the rail: a violet gradient with a soft violet glow. Its
 * plus turns into a cross while the create fan is open.
 */
export function CreateButton({
  open,
  progress,
  hitSlop,
  onPress,
}: {
  open: boolean;
  progress: SharedValue<number>;
  /** The button takes the touches of its whole slot in the bar or the rail. */
  hitSlop: Insets;
  onPress: () => void;
}): ReactElement {
  const theme = useAppTheme();
  const turn = useAnimatedStyle(() => ({
    transform: [{ rotate: `${interpolate(progress.get(), [0, 1], [0, 45])}deg` }],
  }));
  return (
    <Touchable
      feedback="scale"
      radius={TAB_BAR.createSize / 2}
      hitSlop={hitSlop}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={open ? "Close the create menu" : "Create"}
      accessibilityHint={open ? undefined : "Opens New Task, New Chat, and Import."}
      accessibilityState={{ expanded: open }}
      style={styles.create}
    >
      {/* The gesture handler button draws no CSS gradient, so a view inside it does. */}
      <View style={styles.createFill}>
        <Animated.View style={turn}>
          <Icon name="plus" size={26} colorValue={theme.colors.onTint} />
        </Animated.View>
      </View>
    </Touchable>
  );
}

const styles = StyleSheet.create((theme) => ({
  create: {
    width: TAB_BAR.createSize,
    height: TAB_BAR.createSize,
    borderRadius: TAB_BAR.createSize / 2,
    boxShadow: theme.shadows.primary,
  },
  // The one filled control of the bar: a violet gradient with a soft violet glow.
  createFill: {
    width: "100%",
    height: "100%",
    borderRadius: TAB_BAR.createSize / 2,
    alignItems: "center",
    justifyContent: "center",
    backgroundImage: `linear-gradient(150deg, ${theme.palette.violet500}, ${theme.colors.tintFill} 70%)`,
  },
}));
