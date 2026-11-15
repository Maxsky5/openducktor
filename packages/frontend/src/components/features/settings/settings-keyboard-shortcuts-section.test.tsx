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
const field = (label: string) =>
  screen.getByRole("button", { name: `Record shortcut for ${label}` });
const record = async (label: string, event: Partial<KeyboardEventInit>) => {
  fireEvent.click(field(label));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Press a key"));
  fireEvent.keyDown(window, event);
};

test("records keys, shows a conflict before saving, and reassigns after an explicit choice", async () => {
  const write = renderSection();
  await record("Open diagnostics", { key: "b", code: "KeyB", ctrlKey: true });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Toggle sidebar"));
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Use here instead" }));
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
  await act(async () => {
    fireEvent.click(save);
  });
  expect(write.mock.calls[0]![0].overrides).toEqual({
    diagnostics: keys("f9", { mod: true, shift: true }),
  });
  await waitFor(() => expect(field("Open diagnostics").textContent).toBe("CtrlShiftF9"));
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

test("removes and restores shortcuts at once, and resets all after confirmation", async () => {
  const write = renderSection({ diagnostics: keys("f8", { mod: true }) });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Remove shortcut for Toggle sidebar" }));
  });
  expect(write.mock.calls[0]![0].overrides).toEqual({
    diagnostics: keys("f8", { mod: true }),
    sidebar: null,
  });
  await waitFor(() => expect(field("Toggle sidebar").textContent).toBe("Add shortcut"));
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: "Restore default shortcut for Open diagnostics" }),
    );
  });
  expect(write.mock.calls[1]![0].overrides).toEqual({ sidebar: null });
  fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(write).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
  await act(async () => {
    fireEvent.click(await screen.findByRole("button", { name: "Reset all shortcuts" }));
  });
  expect(write.mock.calls[2]![0]).toEqual({ version: 1, overrides: {} });
});

test("filters by assignment state and finds commands by their keys", () => {
  const write = renderSection({ diagnostics: keys("f8", { mod: true }) });
  fireEvent.click(screen.getByRole("button", { name: /^Changed/ }));
  expect(field("Open diagnostics")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Record shortcut for Toggle sidebar" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^All/ }));
  fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), {
    target: { value: "ctrl b" },
  });
  expect(field("Toggle sidebar")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Record shortcut for Open diagnostics" })).toBeNull();
  expect(write).not.toHaveBeenCalled();
});

test("folds the ten position commands into one row until opened", () => {
  renderSection();
  expect(
    screen.queryByRole("button", { name: "Record shortcut for Select session at position 1" }),
  ).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Go to session 1–10/ }));
  expect(field("Select session at position 1").textContent).toBe("Ctrl1");
});

test("marks only the assignment that cannot run on this device", () => {
  renderSection({
    diagnostics: keys("b", { mod: true }),
    "workflow:unavailable-workflow:start": keys("f8", { mod: true }),
  });
  expect(screen.getByText(/Off on this device: Ctrl\+B is used by Toggle sidebar/)).toBeTruthy();
  expect(screen.getByText("This workflow action is not available on this host.")).toBeTruthy();
  expect(field("Toggle sidebar").textContent).toBe("CtrlB");
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
});
