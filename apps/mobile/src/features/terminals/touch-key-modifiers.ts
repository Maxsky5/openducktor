import type { TerminalKeyModifiers } from "@openducktor/frontend-core/terminals/terminal-keyboard-policy";

export const NO_TOUCH_MODIFIERS: TerminalKeyModifiers = { ctrl: false, alt: false };

export type TouchModifierAction =
  | { type: "toggled"; modifier: keyof TerminalKeyModifiers }
  /** A key or typed character used the held modifiers. */
  | { type: "used" };

/**
 * The sticky Ctrl and Alt keys of the touch key row. A tap holds the modifier for the next key or
 * typed character, and a second tap releases it.
 */
export const touchModifiersReducer = (
  state: TerminalKeyModifiers,
  action: TouchModifierAction,
): TerminalKeyModifiers => {
  if (action.type === "used") {
    return state.ctrl || state.alt ? NO_TOUCH_MODIFIERS : state;
  }
  return action.modifier === "ctrl"
    ? { ...state, ctrl: !state.ctrl }
    : { ...state, alt: !state.alt };
};
