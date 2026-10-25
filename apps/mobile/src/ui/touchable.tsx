import { type ReactElement, type ReactNode, use, useMemo } from "react";
import type {
  AccessibilityActionEvent,
  AccessibilityActionInfo,
  AccessibilityProps,
  Insets,
  StyleProp,
  ViewStyle,
} from "react-native";
import { Touchable as GestureTouchable } from "react-native-gesture-handler";
import { useReducedMotion } from "react-native-reanimated";
import { createUnistylesElement, StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { motion } from "@/theme/tokens";
import { haptics } from "./haptics";
import { MenuTriggerContext } from "./menu-trigger-context";

/**
 * The press feedback of a control. Rows highlight their background, buttons and cards scale a
 * little, and plain text or icon controls dim. Both platforms use the same feedback.
 */
type TouchFeedback = "highlight" | "scale" | "opacity";

export type TouchableProps = Pick<
  AccessibilityProps,
  | "accessibilityRole"
  | "accessibilityLabel"
  | "accessibilityHint"
  | "accessibilityState"
  | "accessibilityValue"
  | "accessibilityLiveRegion"
> & {
  feedback: TouchFeedback;
  onPress?: (() => void) | undefined;
  onLongPress?: (() => void) | undefined;
  disabled?: boolean | undefined;
  /** False for a control that waits for its own action: it stops taking presses but stays bright. */
  dimWhenDisabled?: boolean | undefined;
  /** The visual style: padding, background, radius, layout of the children. */
  style?: StyleProp<ViewStyle>;
  /** The layout of the touch area in its parent, such as `flex: 1`. */
  containerStyle?: StyleProp<ViewStyle>;
  /** The corner radius, so the highlight follows the shape. */
  radius?: number | undefined;
  hitSlop?: number | Insets | undefined;
  /** Extra screen reader actions, such as the actions of a row menu. Activate presses. */
  accessibilityActions?: readonly AccessibilityActionInfo[] | undefined;
  onAccessibilityAction?: ((event: AccessibilityActionEvent) => void) | undefined;
  testID?: string | undefined;
  nativeID?: string | undefined;
  children: ReactNode;
};

const LONG_PRESS = 420;
/** The opacity of a disabled control. */
const DISABLED_OPACITY = 0.5;
/** The press animation: in with the press duration, out a little slower. */
const PRESS_DURATION = { tap: { in: motion.press, out: 240 }, hover: { in: 0, out: 0 } } as const;

const roundings = new Map<number, ViewStyle>();
/** One style object for each corner radius, so the style of a control keeps its identity. */
const roundingOf = (radius: number): ViewStyle => {
  let rounding = roundings.get(radius);
  if (!rounding) {
    rounding = { borderRadius: radius, borderCurve: "continuous" };
    roundings.set(radius, rounding);
  }
  return rounding;
};

const ACTIVATE = { name: "activate" } as const;
const LONG_PRESS_ACTION = { name: "longpress" } as const;
const NO_ACTIONS: readonly AccessibilityActionInfo[] = [];

/**
 * The Unistyles Babel plugin binds only the React Native and Reanimated views. The Gesture Handler
 * button is a native view of its own, and its ref is that view, so this wrapper binds the styles
 * in the same way: a theme change updates them in native code, with no render.
 */
const NativeTouchable = createUnistylesElement(GestureTouchable);

/**
 * A pressable control on the native button of Gesture Handler. The native button runs the press
 * feedback from the touch, so it shows in the next frame even while JavaScript works, and a
 * control costs one native view and no animation state. In a scroll view, the feedback waits
 * for the system tap delay, so a scroll that starts on a row does not flash it. The press commits
 * when the finger lifts.
 */
export function Touchable({
  feedback,
  onPress,
  onLongPress,
  disabled = false,
  dimWhenDisabled = true,
  style,
  containerStyle,
  radius = 0,
  hitSlop,
  accessibilityActions = NO_ACTIONS,
  onAccessibilityAction,
  testID,
  nativeID,
  children,
  ...accessibility
}: TouchableProps): ReactElement {
  const menu = use(MenuTriggerContext);
  const theme = useAppTheme();
  const reducedMotion = useReducedMotion();

  // Inside a native menu trigger on Android, this control opens the menu (see MenuTriggerContext).
  const press = (): void => {
    onPress?.();
    if (menu && !menu.onLongPress) {
      haptics.selection();
      menu.open();
    }
  };
  const longPress = (): void => {
    haptics.light();
    onLongPress?.();
    if (menu?.onLongPress) menu.open();
  };
  const hasLongPress = onLongPress !== undefined || menu?.onLongPress === true;
  const handleAccessibilityAction = (event: AccessibilityActionEvent) => {
    if (disabled) return;
    const { actionName } = event.nativeEvent;
    if (actionName === "activate") press();
    else if (actionName === "longpress") longPress();
    else onAccessibilityAction?.(event);
  };

  const feedbackProps =
    feedback === "highlight"
      ? { underlayColor: theme.colors.fillStrong, activeUnderlayOpacity: 1 }
      : feedback === "opacity"
        ? { activeOpacity: 0.4 }
        : reducedMotion
          ? { activeOpacity: 0.75 }
          : { activeScale: 0.97 };
  const dimmed = disabled && dimWhenDisabled;
  // The array keeps its identity while its parts do, so a render with the same styles sends no
  // new style props.
  const buttonStyle = useMemo(
    () => [
      containerStyle,
      style,
      radius > 0 ? roundingOf(radius) : null,
      feedback === "highlight" ? styles.clip : null,
      dimmed ? styles.dimmed : null,
    ],
    [containerStyle, dimmed, feedback, radius, style],
  );

  return (
    <NativeTouchable
      {...accessibility}
      {...feedbackProps}
      accessible
      // A control can stay pressable to explain why it is off, so either source marks it disabled.
      accessibilityState={{
        ...accessibility.accessibilityState,
        disabled: disabled || accessibility.accessibilityState?.disabled === true,
      }}
      accessibilityActions={[
        ACTIVATE,
        ...(hasLongPress ? [LONG_PRESS_ACTION] : NO_ACTIONS),
        ...accessibilityActions,
      ]}
      onAccessibilityAction={handleAccessibilityAction}
      testID={testID}
      nativeID={nativeID}
      disabled={disabled}
      hitSlop={hitSlop}
      onPress={press}
      onLongPress={hasLongPress ? longPress : undefined}
      delayLongPress={LONG_PRESS}
      animationDuration={PRESS_DURATION}
      defaultOpacity={dimmed ? DISABLED_OPACITY : 1}
      // On Android the button applies `defaultOpacity` only when it mounts or after a press, so a
      // later change of `disabled` keeps the old look. The style opacity applies at once.
      style={buttonStyle}
    >
      {children}
    </NativeTouchable>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: "hidden" },
  dimmed: { opacity: DISABLED_OPACITY },
});
