import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ShortcutCombination, ShortcutPreferences } from "@openducktor/contracts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { shortcutRecording } from "@/features/shortcuts/recording-store";
import { ShortcutTestProviders } from "@/test-utils/shortcut-providers";
import { SettingsKeyboardShortcutsSection } from "./settings-keyboard-shortcuts-section";

const keys = (key: string, modifiers: Partial<ShortcutCombination>): ShortcutCombination => ({
  key: { kind: "logical", key },
  mod: false,
  ctrl: false,
  alt: false,
  shift: false,
  ...modifiers,
});

let releaseRecorder: () => void = () => {};
beforeEach(() => {
  Object.defineProperty(globalThis.navigator, "platform", {
    configurable: true,
    get: () => "Linux x86_64",
  });
  releaseRecorder = shortcutRecording.setPreparer(async () => {});
});
afterEach(() => {
  cleanup();
  releaseRecorder();
});

const renderSection = (overrides: ShortcutPreferences["overrides"] = {}) => {
  const write = mock(async (preferences: ShortcutPreferences) => preferences);
  const connection = createTestClientConnection({
    client: { workspaceSaveKeyboardShortcuts: write },
  });
  connection.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides });
  render(
    <ShortcutTestProviders connection={connection}>
      <SettingsKeyboardShortcutsSection />
    </ShortcutTestProviders>,
  );
  return write;
};
const fieldName = (label: string) => new RegExp(`^${label}, .*(Change shortcut|Add keys)$`);
const field = (label: string) => screen.getByRole("button", { name: fieldName(label) });
const queryField = (label: string) => screen.queryByRole("button", { name: fieldName(label) });
const record = async (label: string, event: Partial<KeyboardEventInit>) => {
  if (!queryField(label)) fireEvent.click(screen.getByRole("button", { name: "All commands" }));
  fireEvent.click(field(label));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Recording keys"));
  fireEvent.keyDown(window, event);
};

test("records keys, shows a conflict before saving, and reassigns after an explicit choice", async () => {
  const write = renderSection();
  await record("Open diagnostics", { key: "b", code: "KeyB", ctrlKey: true });

  expect(screen.getByRole("alert").textContent).toContain("Used by Toggle sidebar.");
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Move keys here" }));
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(write.mock.calls[0]![0].overrides).toEqual({
    diagnostics: keys("b", { mod: true }),
    sidebar: null,
  });
});

test("saves a recorded shortcut and returns focus to its keys", async () => {
  const write = renderSection();
  await record("Open diagnostics", { key: "F9", code: "F9", ctrlKey: true, shiftKey: true });
  const save = await screen.findByRole("button", { name: "Save" });
  expect(save.hasAttribute("disabled")).toBe(false);
  // Enter after recording saves, so focus waits on Save rather than on the keys.
  await waitFor(() => expect(document.activeElement).toBe(save));
  await act(async () => {
    fireEvent.click(save);
  });
  expect(write.mock.calls[0]![0].overrides).toEqual({
    diagnostics: keys("f9", { mod: true, shift: true }),
  });
  await waitFor(() => expect(field("Open diagnostics").textContent).toContain("Ctrl Shift F9"));
  expect(document.activeElement).toBe(field("Open diagnostics"));
});

test("Escape cancels recording and a proposal without saving or closing Settings", async () => {
  const write = renderSection();
  await record("Open diagnostics", { key: "Escape", code: "Escape" });
  await waitFor(() => expect(shortcutRecording.isActive()).toBe(false));
  await record("Open diagnostics", { key: "F9", code: "F9", ctrlKey: true });
  await screen.findByRole("button", { name: "Save" });
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(escape);
  });
  expect(escape.defaultPrevented).toBe(true);
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(write).not.toHaveBeenCalled();
});

test("removes a shortcut at once and resets a changed one to its default", async () => {
  const write = renderSection({
    diagnostics: keys("f8", { mod: true }),
    sidebar: keys("f9", { mod: true }),
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Remove shortcut for Open diagnostics" }));
  });
  expect(write.mock.calls[0]![0].overrides).toEqual({ sidebar: keys("f9", { mod: true }) });
  // The row keeps its place with its own Undo, so nothing moves under the pointer.
  const undo = await screen.findByRole("button", { name: "Undo" });
  expect(document.activeElement).toBe(undo);
  expect(field("Open diagnostics").textContent).toContain("Add keys");
  await act(async () => {
    fireEvent.click(undo);
  });
  expect(write.mock.calls[1]![0].overrides).toEqual({
    diagnostics: keys("f8", { mod: true }),
    sidebar: keys("f9", { mod: true }),
  });
  await waitFor(() => expect(document.activeElement).toBe(field("Open diagnostics")));
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Reset shortcut for Toggle sidebar to its default" }),
    );
  });
  expect(write.mock.calls[2]![0].overrides).toEqual({ diagnostics: keys("f8", { mod: true }) });
});

test("resets every shortcut only after confirmation", async () => {
  const write = renderSection({ sidebar: null });
  fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(write).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Reset all shortcuts" }));
  });
  expect(write.mock.calls[0]![0]).toEqual({ version: 1, overrides: {} });
  await waitFor(() => expect(screen.queryByRole("button", { name: "Reset all" })).toBeNull());
});

test("lists shortcuts in use first and finds any command by name or keys", () => {
  const write = renderSection();
  expect(field("Toggle sidebar")).toBeTruthy();
  expect(queryField("Open diagnostics")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "All commands" }));
  expect(field("Open diagnostics")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "With keys" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), {
    target: { value: "diagnostics" },
  });
  expect(field("Open diagnostics")).toBeTruthy();
  // A search lists every command, and the filter shows that until the search is cleared.
  const all = screen.getByRole("button", { name: "All commands" });
  expect(all.getAttribute("aria-pressed")).toBe("true");
  expect(all.hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), {
    target: { value: "ctrl b" },
  });
  expect(field("Toggle sidebar")).toBeTruthy();
  expect(queryField("Toggle command palette")).toBeNull();
  expect(write).not.toHaveBeenCalled();
});

test("folds the ten position commands into one row until opened", () => {
  renderSection();
  expect(queryField("Select session at position 1")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^Go to session 1–10/ }));
  expect(field("Select session at position 1").textContent).toContain("Ctrl 1");
});

test("marks only the assignment that cannot run on this device", () => {
  renderSection({
    diagnostics: keys("b", { mod: true }),
    "workflow:unavailable-workflow:start": keys("f8", { mod: true }),
  });
  expect(screen.getByText(/Off on this device\. Ctrl\+B is used by Toggle sidebar/)).toBeTruthy();
  expect(screen.getByText(/This workflow action is not available on this host\./)).toBeTruthy();
  expect(field("Toggle sidebar").textContent).toContain("Ctrl B");
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});

test("explains a key pressed without a modifier and keeps recording", async () => {
  const write = renderSection();
  await record("Open diagnostics", { key: "d", code: "KeyD" });
  expect(screen.getByText("Add Ctrl or Alt. D alone types text.")).toBeTruthy();
  fireEvent.keyDown(window, { key: "Control", code: "ControlLeft", ctrlKey: true });
  expect(field("Open diagnostics").textContent).toContain("Ctrl …");
  fireEvent.keyDown(window, { key: "F7", code: "F7", ctrlKey: true });
  expect(await screen.findByRole("button", { name: "Save" })).toBeTruthy();
  expect(write).not.toHaveBeenCalled();
});
