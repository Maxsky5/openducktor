import { requireNativeModule, requireNativeView } from "expo";
import type { ComponentType } from "react";
import type { HardwareKeyboardViewProps } from "./src/OpenDucktorKeyboard.types";

export type {
  HardwareEnterEvent,
  HardwareKeyboardViewProps,
} from "./src/OpenDucktorKeyboard.types";

/**
 * Wraps a multiline `TextInput` and reports hardware keyboard Enter with its Shift state.
 * Plain Enter does not insert a newline. Shift+Enter inserts a newline.
 */
export const HardwareKeyboardView: ComponentType<HardwareKeyboardViewProps> =
  requireNativeView<HardwareKeyboardViewProps>("OpenDucktorKeyboard");

const KeyboardModule = requireNativeModule<{ showKeyboard(viewTag: number): Promise<boolean> }>(
  "OpenDucktorKeyboard",
);

/**
 * Android only: focuses the text field with this view tag, or the first focusable view inside it,
 * and opens the keyboard once its window has the focus. Resolves to false when the view is gone.
 */
export const showKeyboard = (viewTag: number): Promise<boolean> =>
  KeyboardModule.showKeyboard(viewTag);
