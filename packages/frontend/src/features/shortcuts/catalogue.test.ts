import { expect, test } from "bun:test";
import {
  recordShortcut,
  type ShortcutActionId,
  type ShortcutCombination,
  type ShortcutPreferences,
} from "@openducktor/contracts";
import {
  compileShortcuts,
  otherDeviceProblems,
  SHORTCUT_COMMANDS,
  scopesCanCoexist,
  workflowCommandDefinition,
} from "./catalogue";

const keys = (key: string, modifiers: Partial<ShortcutCombination>): ShortcutCombination => ({
  key: { kind: "logical", key },
  mod: false,
  ctrl: false,
  alt: false,
  shift: false,
  ...modifiers,
});
const prefs = (overrides: ShortcutPreferences["overrides"]): ShortcutPreferences => ({
  version: 1,
  overrides,
});
const problem = (preferences: ShortcutPreferences, id: ShortcutActionId) =>
  compileShortcuts(preferences, SHORTCUT_COMMANDS, "darwin", "electron").problems.get(id)?.message;

test("keeps the agreed defaults active on each platform and shell", () => {
  for (const platform of ["darwin", "linux", "win32"] as const)
    for (const shell of ["electron", "browser"] as const)
      expect([...compileShortcuts(prefs({}), SHORTCUT_COMMANDS, platform, shell).problems]).toEqual(
        [],
      );
});

test("turns off only the assignment that cannot run on this device", () => {
  const preferences = prefs({ "new-bottom-tab": keys("t", { mod: true }) });
  const electron = compileShortcuts(preferences, SHORTCUT_COMMANDS, "darwin", "electron");
  const browser = compileShortcuts(preferences, SHORTCUT_COMMANDS, "darwin", "browser");
  expect(electron.problems.size).toBe(0);
  expect(browser.problems.get("new-bottom-tab")?.message).toContain("reserved by the browser");
  expect(browser.byId.has("palette")).toBe(true);
  expect(browser.byId.size).toBe(electron.byId.size - 1);
});

test("resolves one portable assignment to the matching keys on every device", () => {
  const preferences = prefs({ diagnostics: keys("p", { mod: true, shift: true }) });
  expect(
    compileShortcuts(preferences, SHORTCUT_COMMANDS, "darwin", "electron").byId.get("diagnostics")
      ?.signature,
  ).toBe("meta+shift:p");
  expect(
    compileShortcuts(preferences, SHORTCUT_COMMANDS, "win32", "browser").byId.get("diagnostics")
      ?.signature,
  ).toBe("ctrl+shift:p");
});

test("names the command that keeps overlapping keys", () => {
  const conflict = compileShortcuts(
    prefs({ diagnostics: keys("k", { mod: true }) }),
    SHORTCUT_COMMANDS,
    "darwin",
    "electron",
  ).problems.get("diagnostics");
  expect(conflict?.conflict?.id).toBe("palette");
  expect(conflict?.message).toBe("⌘K is used by Toggle command palette.");
});

test("lets exclusive scopes share keys and keeps coexisting scopes apart", () => {
  const shared = prefs({
    "chat-rename": keys("e", { mod: true }),
    "git-refresh": keys("r", { mod: true, shift: true }),
    "browser-reload": keys("r", { mod: true, shift: true }),
  });
  expect(compileShortcuts(shared, SHORTCUT_COMMANDS, "darwin", "electron").problems.size).toBe(0);
  expect(
    problem(
      prefs({
        "close-panel-tab": keys("r", { mod: true, shift: true }),
        "git-refresh": keys("r", { mod: true, shift: true }),
      }),
      "git-refresh",
    ),
  ).toContain("Close current panel tab");
  expect(
    scopesCanCoexist({ kind: "workflow", workflowId: "a" }, { kind: "workflow", workflowId: "b" }),
  ).toBe(false);
  expect(
    scopesCanCoexist({ kind: "workflow", workflowId: "a" }, { kind: "record", record: "task" }),
  ).toBe(true);
});

test("names the other devices where Mod and Control assignments collide", () => {
  const catalogue = [...SHORTCUT_COMMANDS, workflowCommandDefinition("workflow:a:b", "a", "Start")];
  const preferences = prefs({ diagnostics: keys("b", { mod: true }) });
  expect(problem(preferences, "diagnostics")).toBeUndefined();
  expect(
    otherDeviceProblems(preferences, catalogue, "diagnostics", {
      platform: "darwin",
      shell: "electron",
    }),
  ).toEqual([
    "the desktop app on Windows",
    "the browser on Windows",
    "the desktop app on Linux",
    "the browser on Linux",
  ]);
});

test.each(["backspace", "delete", "arrowleft", "arrowright", "arrowup", "arrowdown"])(
  "protects macOS Option editing with %s, including selection",
  (key) => {
    for (const shift of [false, true])
      expect(problem(prefs({ settings: keys(key, { alt: true, shift }) }), "settings")).toContain(
        "native editing and selection",
      );
  },
);

test.each(["t", "v", "y"])("protects macOS Control+%s editing while typing", (key) => {
  expect(problem(prefs({ settings: keys(key, { ctrl: true }) }), "settings")).toContain(
    "Control-key editing",
  );
});

test("applies the when choice of an app command, and keeps approved defaults only by default", () => {
  const compiled = (preferences: ShortcutPreferences) =>
    compileShortcuts(preferences, SHORTCUT_COMMANDS, "darwin", "electron");
  // Ctrl+B replaces backward movement only because the specification approves that default.
  expect(compiled(prefs({})).byId.get("sidebar")?.command.allowInput).toBe(true);
  const notTyping = compiled({ ...prefs({}), when: { sidebar: "not-typing" } });
  expect(notTyping.byId.get("sidebar")?.command.allowInput).toBe(false);
  expect(notTyping.problems.size).toBe(0);

  // Control+T edits text, so a command that also runs while typing cannot use it.
  const controlT = prefs({ diagnostics: keys("t", { ctrl: true }) });
  expect(problem(controlT, "diagnostics")).toBeUndefined();
  expect(problem({ ...controlT, when: { diagnostics: "always" } }, "diagnostics")).toContain(
    "Control-key editing",
  );
});

test("keeps a Control+Option number row on macOS and turns it off where AltGr types", () => {
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
  const preferences = prefs({ settings: recorded! });
  expect(problem(preferences, "settings")).toBeUndefined();
  for (const platform of ["win32", "linux"] as const)
    expect(
      compileShortcuts(preferences, SHORTCUT_COMMANDS, platform, "electron").problems.get(
        "settings",
      )?.message,
    ).toContain("AltGr");
});
