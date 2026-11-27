import { type ComponentRef, useRef, useState } from "react";
import { Pressable, TextInput, View, type ViewStyle } from "react-native";
import Animated, { type CSSStyle } from "react-native-reanimated";
import { StyleSheet } from "react-native-unistyles";
import { focusWithKeyboard } from "@/ui/focus-with-keyboard";
import { Text } from "@/ui/text";
import { useEndlessAnimation } from "@/ui/use-endless-animation";
import {
  CODE_SLOTS,
  selectionForSlot,
  slotIsActive,
  type CodeSelection,
} from "@openducktor/frontend-core/lib/pairing-code-selection";
import { useCodeFieldEditing } from "./code-field-editing";

/**
 * A clear color that is not 0. On Android, a text color of 0 draws the text, as
 * `anti-slop/no-transparent-text-color` says. The selection color uses it to hide the highlight.
 */
const HIDDEN_TEXT = "rgba(255, 255, 255, 0)";

/** The pulse of the caret in the active empty slot, as the desktop `animate-pulse` caret. */
const CARET_PULSE: CSSStyle<ViewStyle> = {
  animationName: { "50%": { opacity: 0.5 } },
  animationDuration: 2000,
  animationIterationCount: "infinite",
  animationTimingFunction: "ease-in-out",
};

/**
 * Six visible digit slots over one hidden real field that holds the whole code, so typing,
 * autofill, and screen readers work. A tap on a digit selects it, so the next digit replaces it.
 * The form shows a failure below the field.
 *
 * The slots sit above the field and take the taps, so a tap picks a slot, not a native text
 * position. The field stays visible to screen readers, so it cannot use opacity 0.
 * `useCodeFieldEditing` gives the platform rules that replace a selected digit.
 */
export function PairingCodeInput({
  value,
  onChange,
  disabled = false,
  invalid = false,
  hint,
  onSubmit,
}: {
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  invalid?: boolean;
  /** The spoken description of the field, such as the failure that the form shows. */
  hint?: string | undefined;
  onSubmit(): void;
}) {
  const field = useRef<ComponentRef<typeof TextInput>>(null);
  const [focused, setFocused] = useState(false);
  // This component owns the selection. React Native sets the field selection again after each
  // native selection change, such as the caret move of a focus or a typed digit.
  const [selection, setSelection] = useState<CodeSelection>({
    start: value.length,
    end: value.length,
  });
  // A selection longer than the value stops Android, so it never passes the value's end.
  const shown = {
    start: Math.min(selection.start, value.length),
    end: Math.min(selection.end, value.length),
  };
  const editing = useCodeFieldEditing({ value, selection: shown, select: setSelection, onChange });
  const caret = useEndlessAnimation(CARET_PULSE);
  return (
    <View style={styles.field}>
      <Text variant="subhead" weight="medium">
        Pairing code
      </Text>
      <View style={styles.control}>
        <TextInput
          ref={field}
          accessibilityLabel="Pairing code"
          accessibilityHint={
            hint ?? "Enter the six-digit code that Add device shows on your computer."
          }
          accessibilityState={{ disabled }}
          value={value}
          {...editing}
          selectionColor={HIDDEN_TEXT}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          editable={!disabled}
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          importantForAutofill="yes"
          autoCorrect={false}
          spellCheck={false}
          caretHidden
          contextMenuHidden
          underlineColorAndroid="transparent"
          returnKeyType="go"
          onSubmitEditing={onSubmit}
          style={styles.input}
        />
        {/* The gaps pass a touch to the field, so a tap at its center, as VoiceOver sends, focuses it. */}
        <View
          style={styles.slots}
          pointerEvents="box-none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {CODE_SLOTS.map((position) => {
            const digit = value[position];
            const isActive = focused && slotIsActive(shown, position);
            return (
              <Pressable
                key={position}
                disabled={disabled}
                onPress={() => {
                  setSelection(selectionForSlot(position, value));
                  focusWithKeyboard(field.current);
                }}
                style={[
                  styles.slot,
                  position === 3 && styles.group,
                  invalid && styles.invalid,
                  isActive && styles.focused,
                  isActive && shown.start !== shown.end && styles.selected,
                ]}
              >
                <Text variant="mono" style={styles.digit}>
                  {digit ?? ""}
                </Text>
                {digit === undefined &&
                  (isActive ? (
                    <Animated.View style={[styles.caret, caret]} />
                  ) : (
                    <View style={styles.dot} />
                  ))}
              </Pressable>
            );
          })}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  field: { gap: theme.space.sm },
  control: { position: "relative" },
  slots: { flexDirection: "row", gap: 6 },
  slot: {
    flex: 1,
    minWidth: 0,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: theme.desktop.input,
    borderRadius: theme.radius.lg,
    backgroundColor: theme.colors.surface,
  },
  group: { marginLeft: 6 },
  focused: { borderColor: theme.desktop.ring },
  selected: { backgroundColor: theme.colors.insetFill },
  invalid: { borderColor: theme.colors.red },
  digit: { fontSize: 26, lineHeight: 34, paddingVertical: 8 },
  dot: {
    position: "absolute",
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: theme.colors.quaternaryLabel,
  },
  caret: {
    position: "absolute",
    width: 2,
    height: 26,
    borderRadius: 1,
    backgroundColor: theme.desktop.foreground,
  },
  input: {
    ...StyleSheet.absoluteFillObject,
    color: HIDDEN_TEXT,
    backgroundColor: "transparent",
    fontSize: 26,
    padding: 0,
  },
}));
