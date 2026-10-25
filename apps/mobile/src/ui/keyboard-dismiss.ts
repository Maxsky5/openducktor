import { Keyboard, Platform } from "react-native";

/**
 * The `keyboardDismissMode` of a scroll view that closes the keyboard on a drag. On iOS the
 * keyboard follows the finger, and a drag back up keeps it open. Android has no interactive mode,
 * so there the keyboard closes when a drag starts.
 */
export const KEYBOARD_DISMISS_ON_DRAG = Platform.OS === "ios" ? "interactive" : "on-drag";

/**
 * Blurs the focused text field, which also closes the keyboard. A control calls it before it opens
 * a menu, a sheet, or a system picker. On Android each of these is a new window. When that window
 * closes, the field takes the focus back and opens the keyboard over the screen that then shows,
 * such as a sheet.
 */
export const blurFocusedField = (): void => {
  Keyboard.dismiss();
};
