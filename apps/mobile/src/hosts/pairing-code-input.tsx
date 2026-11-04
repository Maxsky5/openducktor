import { useRef, useState } from "react";
import { TextInput, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Text } from "@/ui/text";
import {
  CODE_SLOTS,
  sanitizePairingCode,
  selectionAfterEdit,
  selectionForTap,
  slotIsActive,
  type CodeSelection,
} from "@openducktor/frontend-core/lib/pairing-code-selection";

/**
 * Six visible digit slots over one real field, so typing, paste, and autofill all work. A tap on a
 * digit selects it, so the next digit replaces it. The form shows a failure below the field.
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
  const [focused, setFocused] = useState(false);
  const [selection, setSelection] = useState<CodeSelection>({
    start: value.length,
    end: value.length,
  });
  // The right edge of each slot, to map a tap on the field to a slot.
  const slotEnds = useRef<number[]>([]);
  // The native caret event that follows an edit would undo the selection of the next digit.
  const edited = useRef(false);
  // A selection longer than the value stops Android, so it never passes the value's end.
  const shown = {
    start: Math.min(selection.start, value.length),
    end: Math.min(selection.end, value.length),
  };
  const active = (position: number) => focused && slotIsActive(shown, position);
  return (
    <View style={styles.field}>
      <Text variant="subhead" weight="medium">
        Pairing code
      </Text>
      <View style={styles.control}>
        <View
          style={styles.slots}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {CODE_SLOTS.map((position) => (
            <View
              key={position}
              onLayout={(event) => {
                const { x, width } = event.nativeEvent.layout;
                slotEnds.current[position] = x + width;
              }}
              style={[
                styles.slot,
                position === 3 && styles.group,
                invalid && styles.invalid,
                active(position) && styles.focused,
                active(position) && shown.start !== shown.end && styles.selected,
              ]}
            >
              <Text variant="mono" style={styles.digit}>
                {value[position] ?? ""}
              </Text>
              {!value[position] ? <View style={styles.dot} /> : null}
            </View>
          ))}
        </View>
        <TextInput
          accessibilityLabel="Pairing code"
          accessibilityHint={
            hint ?? "Enter the six-digit code that Add device shows on your computer."
          }
          accessibilityState={{ disabled }}
          value={value}
          selection={shown}
          onPressIn={(event) =>
            setSelection(selectionForTap(slotEnds.current, event.nativeEvent.locationX, value))
          }
          onChangeText={(text) => {
            const next = sanitizePairingCode(text);
            edited.current = true;
            setSelection(selectionAfterEdit(value, next));
            onChange(next);
          }}
          onSelectionChange={(event) => {
            if (edited.current) {
              edited.current = false;
              return;
            }
            setSelection(event.nativeEvent.selection);
          }}
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
  input: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.01,
    color: "transparent",
    backgroundColor: "transparent",
    fontSize: 26,
    padding: 0,
  },
}));
