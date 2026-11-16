import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ShortcutCombination, ShortcutPreferences } from "@openducktor/contracts";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { shortcutRecording } from "@/features/shortcuts/recording-store";
import { ShortcutTestProviders } from "@/test-utils/shortcut-providers";
import { SettingsKeyboardShortcutsSection } from "./settings-keyboard-shortcuts-section";
import { ShortcutDraftContext, useShortcutDraft } from "./use-shortcut-draft";

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

/** The section inside the Settings form: its draft, and the footer's Save settings and Cancel. */
function SettingsForm() {
  const draft = useShortcutDraft();
  return (
    <ShortcutDraftContext value={draft}>
      <SettingsKeyboardShortcutsSection disabled={false} />
      <button type="button" onClick={() => void draft.save()}>
        Save settings
      </button>
      <button type="button" onClick={draft.discard}>
        Discard changes
      </button>
    </ShortcutDraftContext>
  );
}

const renderSection = (
  overrides: ShortcutPreferences["overrides"] = {},
  save = async (preferences: ShortcutPreferences) => preferences,
) => {
  const write = mock(save);
  const connection = createTestClientConnection({
    client: { workspaceSaveKeyboardShortcuts: write },
  });
  connection.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides });
  render(
    <ShortcutTestProviders connection={connection}>
      <SettingsForm />
    </ShortcutTestProviders>,
  );
  return write;
};
const fieldName = (label: string) => new RegExp(`^${label}, .*(Change shortcut|Add keys)$`);
const field = (label: string) => screen.getByRole("button", { name: fieldName(label) });
const queryField = (label: string) => screen.queryByRole("button", { name: fieldName(label) });
const record = async (label: string, event: Partial<KeyboardEventInit>) => {
  fireEvent.click(field(label));
  await waitFor(() => expect(screen.getByRole("status").textContent).toContain("Recording keys"));
  fireEvent.keyDown(window, event);
};
const saveSettings = async () => {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
  });
};

test("puts recorded keys in the draft, which only Save settings writes", async () => {
  const write = renderSection();
  await record("Open diagnostics", { key: "F9", code: "F9", ctrlKey: true, shiftKey: true });
  // No per-row Save: the keys go into the form, and focus returns to them.
  await waitFor(() => expect(field("Open diagnostics").textContent).toContain("Ctrl Shift F9"));
  await waitFor(() => expect(document.activeElement).toBe(field("Open diagnostics")));
  expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  expect(write).not.toHaveBeenCalled();
  await saveSettings();
  expect(write.mock.calls[0]![0].overrides).toEqual({
    diagnostics: keys("f9", { mod: true, shift: true }),
  });
});

test("explains a conflict, and Replace moves the keys in the draft", async () => {
  const write = renderSection();
  await record("Open diagnostics", { key: "b", code: "KeyB", ctrlKey: true });
  const alert = screen.getByRole("alert");
  expect(alert.textContent).toContain("is already the shortcut for Toggle sidebar");
  expect(alert.textContent).toContain("removes them from Toggle sidebar");
  // Replace has focus, so Enter confirms the explicit choice.
  const replace = screen.getByRole("button", { name: "Replace" });
  await waitFor(() => expect(document.activeElement).toBe(replace));
  fireEvent.click(replace);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(field("Toggle sidebar").textContent).toContain("Add keys");
  expect(write).not.toHaveBeenCalled();
  await saveSettings();
  expect(write.mock.calls[0]![0].overrides).toEqual({
    diagnostics: keys("b", { mod: true }),
    sidebar: null,
  });
});

test("keeps other rows usable during an edit, and moves the edit to the row clicked next", async () => {
  renderSection();
  await record("Open diagnostics", { key: "b", code: "KeyB", ctrlKey: true });
  expect(screen.getByRole("alert")).toBeTruthy();
  // Other rows stay enabled; dimming the whole list for an edit made Settings blink.
  expect(field("Show tour").hasAttribute("disabled")).toBe(false);
  fireEvent.click(field("Show tour"));
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toContain("Recording keys for Show tour"),
  );
  expect(screen.queryByRole("alert")).toBeNull();
});

test("Escape cancels recording and a conflict without changing the draft or closing Settings", async () => {
  const write = renderSection();
  await record("Open diagnostics", { key: "Escape", code: "Escape" });
  await waitFor(() => expect(shortcutRecording.isActive()).toBe(false));
  await record("Open diagnostics", { key: "b", code: "KeyB", ctrlKey: true });
  expect(screen.getByRole("alert")).toBeTruthy();
  const escape = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
  act(() => {
    window.dispatchEvent(escape);
  });
  expect(escape.defaultPrevented).toBe(true);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(field("Open diagnostics").textContent).toContain("Add keys");
  await saveSettings();
  expect(write).not.toHaveBeenCalled();
});

test("Remove and Reset to change the draft, and discarding restores the saved keys", async () => {
  const write = renderSection({
    diagnostics: keys("f8", { mod: true }),
    sidebar: keys("f9", { mod: true }),
  });
  fireEvent.click(screen.getByRole("button", { name: "Remove shortcut for Open diagnostics" }));
  expect(field("Open diagnostics").textContent).toContain("Add keys");
  expect(document.activeElement).toBe(field("Open diagnostics"));
  fireEvent.click(
    screen.getByRole("button", { name: /^Reset shortcut for Toggle sidebar to its default/ }),
  );
  expect(field("Toggle sidebar").textContent).toContain("Ctrl B");
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  expect(field("Open diagnostics").textContent).toContain("Ctrl F8");
  fireEvent.click(screen.getByRole("button", { name: "Remove shortcut for Open diagnostics" }));
  await saveSettings();
  expect(write.mock.calls[0]![0].overrides).toEqual({ sidebar: keys("f9", { mod: true }) });
});

test("Reset all puts every default in the draft", async () => {
  const write = renderSection({ sidebar: null });
  fireEvent.click(screen.getByRole("button", { name: "Reset all" }));
  expect(field("Toggle sidebar").textContent).toContain("Ctrl B");
  expect(screen.queryByRole("button", { name: "Reset all" })).toBeNull();
  expect(write).not.toHaveBeenCalled();
  await saveSettings();
  expect(write.mock.calls[0]![0]).toEqual({ version: 1, overrides: {} });
});

test("lists every command by default and finds any command by name or keys", () => {
  renderSection();
  const filter = (name: string) => screen.getByRole("radio", { name });
  expect(filter("All commands").getAttribute("aria-checked")).toBe("true");
  expect(field("Open diagnostics")).toBeTruthy();
  fireEvent.click(filter("Assigned"));
  expect(field("Toggle sidebar")).toBeTruthy();
  expect(queryField("Open diagnostics")).toBeNull();
  fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), {
    target: { value: "diagnostics" },
  });
  expect(field("Open diagnostics")).toBeTruthy();
  // A search lists every command, and the filter shows that until the search is cleared.
  expect(filter("All commands").getAttribute("aria-checked")).toBe("true");
  expect(filter("All commands").hasAttribute("disabled")).toBe(true);
  fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), {
    target: { value: "ctrl b" },
  });
  expect(field("Toggle sidebar")).toBeTruthy();
  expect(queryField("Toggle command palette")).toBeNull();
});

test("puts a When choice in the draft, and rejects a choice its keys cannot support", async () => {
  // Control+H deletes text while typing, so only a command that skips typing may use it.
  const write = renderSection({ diagnostics: keys("h", { mod: true }) });
  fireEvent.click(screen.getByRole("button", { name: "When Toggle sidebar runs: Always" }));
  fireEvent.click(await screen.findByRole("option", { name: /^Not while typing/ }));
  expect(
    await screen.findByRole("button", { name: "When Toggle sidebar runs: Not while typing" }),
  ).toBeTruthy();
  fireEvent.click(
    screen.getByRole("button", { name: "When Open diagnostics runs: Not while typing" }),
  );
  fireEvent.click(await screen.findByRole("option", { name: /^Always/ }));
  expect(screen.getByRole("alert").textContent).toContain("cannot run while typing");
  await saveSettings();
  expect(write.mock.calls[0]![0]).toEqual({
    version: 1,
    overrides: { diagnostics: keys("h", { mod: true }) },
    when: { sidebar: "not-typing" },
  });
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
  await waitFor(() => expect(field("Open diagnostics").textContent).toContain("Ctrl F7"));
  expect(write).not.toHaveBeenCalled();
});

test("names each position row by its own position when the filter hides some", () => {
  renderSection({ "session-position-1": null });
  fireEvent.click(screen.getByRole("radio", { name: "Assigned" }));
  fireEvent.click(screen.getByRole("button", { name: /^Go to session 1–10/ }));
  expect(field("Select session at position 2").closest("li")?.textContent).toContain("Session 2");
  expect(screen.queryByText("Session 1")).toBeNull();
});

test("locks the shortcuts while Save settings writes them", async () => {
  const pending = Promise.withResolvers<ShortcutPreferences>();
  const write = renderSection({}, () => pending.promise);
  fireEvent.click(screen.getByRole("button", { name: "Remove shortcut for Toggle sidebar" }));
  await saveSettings();
  expect(write).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(field("Toggle sidebar").hasAttribute("disabled")).toBe(true));
  expect(screen.getByRole("button", { name: "Reset all" }).hasAttribute("disabled")).toBe(true);
  await act(async () => pending.resolve({ version: 1, overrides: { sidebar: null } }));
  await waitFor(() => expect(field("Toggle sidebar").hasAttribute("disabled")).toBe(false));
});

test("offers Reset all when the saved shortcuts are invalid, and saves the defaults", async () => {
  const write = mock(async (preferences: ShortcutPreferences) => preferences);
  const connection = createTestClientConnection({
    client: {
      workspaceGetKeyboardShortcuts: async () => {
        throw new Error("keyboardShortcuts is invalid.");
      },
      workspaceSaveKeyboardShortcuts: write,
    },
  });
  render(
    <ShortcutTestProviders connection={connection}>
      <SettingsForm />
    </ShortcutTestProviders>,
  );
  const alert = await screen.findByText(/keyboardShortcuts is invalid\./);
  expect(field("Toggle sidebar").hasAttribute("disabled")).toBe(true);
  fireEvent.click(
    within(alert.closest('[role="alert"]')!).getByRole("button", { name: "Reset all" }),
  );
  expect(field("Toggle sidebar").hasAttribute("disabled")).toBe(false);
  await saveSettings();
  expect(write.mock.calls[0]![0]).toEqual({ version: 1, overrides: {} });
  await waitFor(() => expect(screen.queryByText(/keyboardShortcuts is invalid\./)).toBeNull());
});
