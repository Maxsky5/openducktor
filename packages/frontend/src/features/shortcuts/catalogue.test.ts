import { expect, test } from "bun:test";
import type { ShortcutCombination } from "@openducktor/contracts";
import { recordShortcut } from "@openducktor/frontend-core/shortcuts/key-matching";
import { validateShortcuts } from "./catalogue";

test.each(["backspace", "delete", "arrowleft", "arrowright", "arrowup", "arrowdown"])(
  "protects macOS Option editing with %s, including selection",
  (key) => {
    for (const shift of [false, true]) {
      const combination: ShortcutCombination = {
        key: { kind: "logical", key },
        ctrl: false,
        meta: false,
        alt: true,
        shift,
      };
      expect(
        validateShortcuts({ version: 1, overrides: { settings: combination } }, "darwin", false),
      ).toContain("native editing and selection");
    }
  },
);

test("rejects a recorded number-row symbol that overlaps workspace navigation", () => {
  const combination = recordShortcut(
    {
      phase: "down",
      key: "№",
      code: "Digit3",
      ctrl: false,
      meta: true,
      alt: false,
      shift: true,
      repeat: false,
      composing: false,
    },
    "darwin",
  );
  expect(combination).not.toBeNull();
  expect(
    validateShortcuts({ version: 1, overrides: { settings: combination! } }, "darwin", false),
  ).toContain("conflicts with");
});

test("keeps the agreed defaults valid on each client platform and shell", () => {
  for (const platform of ["darwin", "linux", "win32"] as const)
    for (const electron of [false, true])
      expect(validateShortcuts({ version: 1, overrides: {} }, platform, electron)).toBeNull();
});

test.each(["t", "v", "y"])("protects macOS Control+%s editing while typing", (key) => {
  expect(
    validateShortcuts(
      {
        version: 1,
        overrides: {
          settings: {
            key: { kind: "logical", key },
            ctrl: true,
            meta: false,
            alt: false,
            shift: false,
          },
        },
      },
      "darwin",
      false,
    ),
  ).toContain("Control-key editing");
});

test("rejects a host-shared Control+Alt number row on devices that protect AltGr", () => {
  const recorded = recordShortcut(
    {
      phase: "down",
      key: "£",
      code: "Digit3",
      ctrl: true,
      meta: false,
      alt: true,
      shift: false,
      repeat: false,
      composing: false,
    },
    "darwin",
  );
  expect(recorded).not.toBeNull();
  const preferences = { version: 1 as const, overrides: { settings: recorded! } };
  expect(validateShortcuts(preferences, "darwin", false)).toBeNull();
  for (const platform of ["win32", "linux"] as const)
    expect(validateShortcuts(preferences, platform, false)).toContain("AltGr");
});
