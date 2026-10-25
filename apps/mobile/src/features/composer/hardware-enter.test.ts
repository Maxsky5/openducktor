import { describe, expect, test } from "bun:test";
import { resolveHardwareEnter } from "./hardware-enter";

describe("resolveHardwareEnter", () => {
  test("sends on Enter when send is open", () => {
    expect(resolveHardwareEnter({ shift: false, suggestionRows: null, sendAllowed: true })).toBe(
      "send",
    );
  });

  test("leaves Shift+Enter to the native line break", () => {
    expect(resolveHardwareEnter({ shift: true, suggestionRows: 3, sendAllowed: true })).toBe(
      "line_break",
    );
  });

  test("picks the suggestion while the suggestion list shows rows", () => {
    expect(resolveHardwareEnter({ shift: false, suggestionRows: 3, sendAllowed: true })).toBe(
      "pick_suggestion",
    );
  });

  test("does not send the typed query while the open list loads or has no row", () => {
    expect(resolveHardwareEnter({ shift: false, suggestionRows: 0, sendAllowed: true })).toBe(
      "none",
    );
  });

  test("does nothing while send is closed", () => {
    expect(resolveHardwareEnter({ shift: false, suggestionRows: null, sendAllowed: false })).toBe(
      "none",
    );
  });
});
