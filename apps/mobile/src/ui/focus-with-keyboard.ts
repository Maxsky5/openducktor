import type { ComponentRef } from "react";
import { findNodeHandle, Platform, type TextInput } from "react-native";
import { showKeyboard } from "../../modules/openducktor-keyboard";

/**
 * Focuses a text field and opens the keyboard. Android ignores a keyboard request from a sheet or
 * a dialog that has just opened, so on Android the native keyboard module asks again when the
 * window of the field has the focus.
 */
export const focusWithKeyboard = (field: ComponentRef<typeof TextInput> | null): void => {
  if (!field) return;
  if (Platform.OS !== "android") {
    field.focus();
    return;
  }
  const viewTag = findNodeHandle(field);
  if (viewTag !== null && viewTag !== undefined) void showKeyboard(viewTag);
};
