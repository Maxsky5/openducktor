import { describe, expect, test } from "bun:test";
import { NO_TOUCH_MODIFIERS, touchModifiersReducer } from "./touch-key-modifiers";

describe("touchModifiersReducer", () => {
  test("holds Ctrl for the next key and releases it after use", () => {
    const held = touchModifiersReducer(NO_TOUCH_MODIFIERS, { type: "toggled", modifier: "ctrl" });
    expect(held).toEqual({ ctrl: true, alt: false });
    expect(touchModifiersReducer(held, { type: "used" })).toEqual(NO_TOUCH_MODIFIERS);
  });

  test("releases a held modifier on a second tap and combines Ctrl and Alt", () => {
    const ctrl = touchModifiersReducer(NO_TOUCH_MODIFIERS, { type: "toggled", modifier: "ctrl" });
    const both = touchModifiersReducer(ctrl, { type: "toggled", modifier: "alt" });
    expect(both).toEqual({ ctrl: true, alt: true });
    expect(touchModifiersReducer(both, { type: "toggled", modifier: "ctrl" })).toEqual({
      ctrl: false,
      alt: true,
    });
  });

  test("keeps the same state when a key uses no modifier", () => {
    expect(touchModifiersReducer(NO_TOUCH_MODIFIERS, { type: "used" })).toBe(NO_TOUCH_MODIFIERS);
  });
});
