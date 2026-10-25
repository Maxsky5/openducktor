import {
  type ComponentRef,
  type ReactElement,
  type ReactNode,
  type Ref,
  useEffect,
  useState,
} from "react";
import { Pressable, TextInput, type TextInputProps, View, type ViewStyle } from "react-native";
import Animated, {
  type CSSStyle,
  interpolateColor,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { useAppTheme } from "@/theme/app-theme-context";
import { motion, verticalTouchSlop } from "@/theme/tokens";
import { haptics } from "./haptics";
import { Icon } from "./icon";
import { Text } from "./text";
import { useAnnounce } from "./use-announce";

export type TextFieldProps = TextInputProps & {
  label: string;
  /** Outlines the field in red and names the problem. */
  error?: string | null | undefined;
  /** A risk that does not stop the action, such as plain HTTP. Hidden while an error shows. */
  warning?: string | null | undefined;
  /** Help under the field. It also shows under an error, as the next step. */
  hint?: string | null | undefined;
  inputRef?: Ref<ComponentRef<typeof TextInput>>;
  mono?: boolean;
  /** Adds the quiet "optional" mark of the desktop labels. */
  optional?: boolean | undefined;
};

/**
 * The desktop input: a white field with an outline and a violet focus ring. The label stays
 * visible above the field, and the error below it.
 */
export function TextField({
  label,
  error,
  warning,
  hint,
  inputRef,
  mono = false,
  optional = false,
  style,
  editable = true,
  onFocus,
  onBlur,
  ...props
}: TextFieldProps): ReactElement {
  const theme = useAppTheme();
  const [focused, setFocused] = useState(false);
  styles.useVariants({ invalid: Boolean(error), mono, focused });
  useAnnounce(error);
  return (
    <View style={styles.field}>
      <Text variant="subhead" weight="medium" tone="label">
        {label}
        {optional ? (
          <Text variant="subhead" tone="tertiary">
            {" optional"}
          </Text>
        ) : null}
      </Text>
      {/* The frame draws the border and the focus ring. On Android a border change on the
          input itself resets its padding. */}
      <View style={[styles.inputFrame, !editable && styles.readOnly]}>
        <TextInput
          ref={inputRef}
          accessibilityLabel={label}
          // The error comes first, so a screen reader names the problem when the field gets focus.
          accessibilityHint={[error, hint].filter(Boolean).join(". ") || undefined}
          accessibilityState={{ disabled: !editable }}
          placeholderTextColor={theme.colors.quaternaryLabel}
          selectionColor={theme.colors.selection}
          selectionHandleColor={theme.colors.tint}
          cursorColor={theme.colors.tint}
          editable={editable}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[styles.input, style]}
          {...props}
        />
      </View>
      {error ? (
        <Text variant="footnote" weight="medium" tone="red" accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : warning ? (
        <View style={styles.warning}>
          <Icon name="triangle-alert" size={13} color="amberText" />
          <Text variant="footnote" weight="medium" tone="amber" style={styles.warningText}>
            {warning}
          </Text>
        </View>
      ) : null}
      {hint ? (
        <Text variant="footnote" tone="tertiary">
          {hint}
        </Text>
      ) : null}
    </View>
  );
}

const TRACK_WIDTH = 46;
const TRACK_HEIGHT = 28;
const THUMB = 22;
const TRAVEL = TRACK_WIDTH - THUMB - 6;

/**
 * The desktop switch: a violet track when on, a quiet track when off, and a white thumb that
 * springs across. It animates on the UI thread from the value, so a fast toggle never lags.
 */
export function Toggle({
  value,
  disabled = false,
}: {
  value: boolean;
  disabled?: boolean;
}): ReactElement {
  const theme = useAppTheme();
  const reducedMotion = useReducedMotion();
  const on = useSharedValue(value ? 1 : 0);
  useEffect(() => {
    on.set(reducedMotion ? (value ? 1 : 0) : withSpring(value ? 1 : 0, motion.settle));
  }, [on, reducedMotion, value]);
  // The desktop switch colors: the input color when off, the switch color when on.
  const offTrack = theme.desktop.input;
  const onTrack = theme.desktop.switchChecked;
  const trackStyle = useAnimatedStyle(() => ({
    backgroundColor: interpolateColor(on.get(), [0, 1], [offTrack, onTrack]),
  }));
  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: on.get() * TRAVEL }],
  }));
  return (
    <Animated.View style={[styles.track, trackStyle, disabled && styles.toggleDisabled]}>
      <Animated.View style={[styles.toggleThumb, thumbStyle]} />
    </Animated.View>
  );
}

/** A row with a switch. The whole row toggles it, with a selection haptic. */
export function SwitchRow({
  label,
  description,
  value,
  onValueChange,
  disabled = false,
}: {
  label: string;
  description?: string | undefined;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean | undefined;
}): ReactElement {
  return (
    <Pressable
      onPress={() => {
        haptics.selection();
        onValueChange(!value);
      }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled }}
      style={styles.switchRow}
    >
      <View style={styles.switchText}>
        <Text variant="body" weight="medium">
          {label}
        </Text>
        {description ? (
          <Text variant="subhead" tone="tertiary">
            {description}
          </Text>
        ) : null}
      </View>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Toggle value={value} disabled={disabled} />
      </View>
    </Pressable>
  );
}

const THUMB_DURATION = motion.base;
const SEGMENT_HEIGHT = 34;
/** A segment keeps the desktop height and gets a touch area of the platform minimum. */
const SEGMENT_SLOP = verticalTouchSlop(SEGMENT_HEIGHT);

const thumbPosition = (width: number, index: number): CSSStyle<ViewStyle> => ({
  width,
  transform: [{ translateX: index * width }],
  transitionProperty: "transform",
  transitionDuration: THUMB_DURATION,
  transitionTimingFunction: motion.easeOut,
});

export type SegmentOption<Value extends string> = {
  value: Value;
  label: string;
  /** An option that cannot run now. It stays visible and dimmed. */
  disabled?: boolean | undefined;
  /** A mark before the label, such as the brand mark of a runtime. */
  leading?: ReactNode | undefined;
};

/**
 * The desktop segmented control: a quiet track with a white thumb that slides to the selected
 * option. Each change ticks a selection haptic.
 */
export function SegmentedControl<Value extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
}: {
  label: string;
  options: readonly SegmentOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  disabled?: boolean | undefined;
}): ReactElement {
  const [width, setWidth] = useState(0);
  const index = Math.max(
    0,
    options.findIndex((option) => option.value === value),
  );
  const segmentWidth = options.length > 0 ? (width - 8) / options.length : 0;
  // The change runs at once: the thumb moves on the UI thread while the screen renders it.
  const select = (next: Value): void => {
    if (next === value) return;
    haptics.selection();
    onChange(next);
  };
  return (
    <View
      style={[styles.segments, disabled && styles.segmentsDisabled]}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
    >
      {width > 0 ? (
        <Animated.View style={[styles.thumb, thumbPosition(segmentWidth, index)]} />
      ) : null}
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => select(option.value)}
            disabled={disabled || option.disabled}
            hitSlop={SEGMENT_SLOP}
            accessibilityRole="radio"
            accessibilityLabel={option.label}
            accessibilityState={{ checked: selected, disabled: disabled || option.disabled }}
            style={[styles.segment, option.disabled && styles.segmentDisabled]}
          >
            {option.leading}
            <Text
              variant="subhead"
              weight="medium"
              numberOfLines={1}
              style={styles.segmentLabel(selected)}
            >
              {option.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: { gap: 8 },
  warning: { flexDirection: "row", alignItems: "center", gap: 6 },
  warningText: { flex: 1 },
  inputFrame: {
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    backgroundColor: theme.colors.surface,
    variants: {
      focused: {
        true: {
          borderColor: theme.colors.tint,
          boxShadow: `0 0 0 3px ${theme.colors.tintSoft}`,
        },
        false: { borderColor: theme.desktop.input },
      },
      invalid: {
        true: { borderColor: theme.colors.red },
        false: {},
      },
    },
  },
  input: {
    minHeight: 48,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    color: theme.colors.label,
    ...theme.type.body,
    fontSize: 16,
    lineHeight: 22,
    textAlignVertical: "center",
    variants: {
      mono: {
        true: { fontFamily: theme.fonts.mono.regular, fontWeight: "400", fontSize: 15 },
        false: {},
      },
    },
  },
  readOnly: { opacity: 0.6 },
  switchRow: {
    minHeight: 52,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.space.md,
    paddingHorizontal: theme.space.lg,
    paddingVertical: theme.space.sm,
    backgroundColor: theme.colors.surface,
  },
  switchText: { flex: 1, gap: 2 },
  track: {
    width: TRACK_WIDTH,
    height: TRACK_HEIGHT,
    borderRadius: TRACK_HEIGHT / 2,
    padding: 3,
    justifyContent: "center",
  },
  toggleThumb: {
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: theme.desktop.switchThumb,
    boxShadow: theme.shadows.thumb,
  },
  toggleDisabled: { opacity: 0.45 },
  // The desktop segmented control: a muted well. Its outline keeps it visible on a page of the same
  // muted color. With the padding, it puts the segments 4 points inside the edge.
  segments: {
    flexDirection: "row",
    backgroundColor: theme.desktop.muted,
    borderRadius: theme.radius.lg,
    borderCurve: "continuous",
    borderWidth: 1,
    borderColor: theme.desktop.border,
    padding: 3,
  },
  segmentsDisabled: { opacity: 0.5 },
  thumb: {
    position: "absolute",
    top: 3,
    bottom: 3,
    left: 3,
    borderRadius: theme.radius.md,
    borderCurve: "continuous",
    boxShadow: theme.shadows.card,
    backgroundColor: theme.desktop.segmentedSelected,
    borderWidth: 1,
    borderColor: theme.desktop.input,
  },
  segment: {
    flex: 1,
    minHeight: SEGMENT_HEIGHT,
    flexDirection: "row",
    gap: 6,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.space.sm,
  },
  segmentDisabled: { opacity: 0.35 },
  segmentLabel: (selected: boolean) => ({
    color: selected ? theme.desktop.foreground : theme.desktop.mutedForeground,
  }),
}));
