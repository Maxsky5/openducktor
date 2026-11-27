import {
  sanitizePairingCode,
  selectionAfterEdit,
  type CodeSelection,
} from "@openducktor/frontend-core/lib/pairing-code-selection";
import { useRef } from "react";
import { Platform, type TextInputProps } from "react-native";
import { editAtCaret, selectionAfterReplace } from "./code-field-edit";

type CodeFieldInput = {
  value: string;
  /** The selection of the slots, never past the end of `value`. */
  selection: CodeSelection;
  select(selection: CodeSelection): void;
  onChange(value: string): void;
};

/** The props that edit the hidden code field. */
type CodeFieldEditing = Required<Pick<TextInputProps, "selection" | "onChangeText">> &
  Pick<TextInputProps, "onKeyPress" | "onSelectionChange">;

/**
 * Android shows no handles for a selection range that the app sets. The field keeps the range and
 * replaces or deletes the selected digit itself, for soft keys, physical keys, and autofill.
 */
const useAndroidCodeFieldEditing = ({
  value,
  selection,
  select,
  onChange,
}: CodeFieldInput): CodeFieldEditing => ({
  selection,
  onChangeText: (text) => {
    const next = sanitizePairingCode(text);
    select(selectionAfterEdit(value, next));
    onChange(next);
  },
  // Android sends no change for a digit replaced by the same digit. Its range then collapses to a
  // caret at the range end, so the next digit selects here.
  onSelectionChange: ({ nativeEvent: { selection: native } }) => {
    const collapsedToEnd = native.start === native.end && native.end === selection.end;
    if (selection.start < selection.end && collapsedToEnd)
      select(selectionAfterReplace(selection, value));
  },
});

/**
 * iOS draws selection handles for a range, even on a hidden field, so the field keeps only a caret
 * at the end of the selection. iOS reports the inserted text in the key event before the change
 * event, so a typed digit replaces the selected one, and an autofill keeps the whole code.
 */
const useIosCodeFieldEditing = ({
  value,
  selection,
  select,
  onChange,
}: CodeFieldInput): CodeFieldEditing => {
  const inserted = useRef<string | null>(null);
  return {
    selection: { start: selection.end, end: selection.end },
    onKeyPress: ({ nativeEvent: { key } }) => {
      inserted.current = key === "Backspace" ? null : key;
    },
    onChangeText: (text) => {
      const edit = editAtCaret(value, selection, text, inserted.current);
      inserted.current = null;
      select(edit.selection);
      onChange(edit.code);
    },
  };
};

/** The editing props of the hidden code field for this platform. */
export const useCodeFieldEditing =
  Platform.OS === "android" ? useAndroidCodeFieldEditing : useIosCodeFieldEditing;
