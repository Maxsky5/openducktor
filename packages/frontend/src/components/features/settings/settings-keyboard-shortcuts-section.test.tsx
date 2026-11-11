import { expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ShortcutTestProviders } from "@/test-utils/shortcut-providers";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { registerShortcutRecorder } from "@/features/shortcuts/recording";
import type { ShortcutPreferences } from "@openducktor/contracts";
import { SettingsKeyboardShortcutsSection } from "./settings-keyboard-shortcuts-section";

test("records, validates, saves, clears and resets shortcuts through Settings", async () => {
  const write = mock(async (preferences: ShortcutPreferences) => preferences);
  const connection = createTestClientConnection({
    client: { workspaceSaveKeyboardShortcuts: write },
  });
  connection.queryClient.setQueryData(["keyboard-shortcuts"], {
    version: 1,
    overrides: {
      diagnostics: {
        key: { kind: "logical", key: "F8" },
        ctrl: true,
        meta: false,
        alt: false,
        shift: true,
      },
    },
  });
  const release = registerShortcutRecorder(async () => {});
  const view = render(
    <ShortcutTestProviders connection={connection}>
      <SettingsKeyboardShortcutsSection />
    </ShortcutTestProviders>,
  );
  const record = async (key: string, code: string, shiftKey = false) => {
    fireEvent.click(screen.getByRole("button", { name: "Record shortcut for Toggle sidebar" }));
    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("Press your shortcut"),
    );
    fireEvent.keyDown(window, { key, code, ctrlKey: true, shiftKey });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(false),
    );
  };
  try {
    fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), {
      target: { value: "Toggle sidebar" },
    });
    await record("F8", "F8", true);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByRole("alert").textContent).toContain("Open diagnostics");
    expect(write).toHaveBeenCalledTimes(0);
    await record("F9", "F9", true);
    act(() => screen.getByRole("button", { name: "Save" }).focus());
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(document.activeElement?.getAttribute("aria-label")).toBe(
      "Record shortcut for Toggle sidebar",
    );
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Record shortcut for Toggle sidebar" }).textContent,
      ).toBe("CtrlShiftF9"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Clear shortcut for Toggle sidebar" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(write.mock.calls[1]![0].overrides.sidebar).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Record shortcut for Toggle sidebar" }).textContent,
      ).toBe("Unassigned"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset all shortcuts" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(write).toHaveBeenCalledTimes(2);
    fireEvent.click(screen.getByRole("button", { name: "Reset all shortcuts" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Confirm reset" }));
    });
    expect(write.mock.calls[2]![0]).toEqual({ version: 1, overrides: {} });
  } finally {
    view.unmount();
    release();
  }
});

test("can clear an invalid saved assignment without changing other shortcuts", async () => {
  const write = mock(async (preferences: ShortcutPreferences) => preferences);
  const connection = createTestClientConnection({
    client: { workspaceSaveKeyboardShortcuts: write },
  });
  const conflict = {
    key: { kind: "logical" as const, key: "F8" },
    ctrl: true,
    meta: false,
    alt: false,
    shift: true,
  };
  connection.queryClient.setQueryData(["keyboard-shortcuts"], {
    version: 1,
    overrides: {
      sidebar: conflict,
      diagnostics: conflict,
      "workflow:unavailable-workflow:start": conflict,
    },
  });
  const view = render(
    <ShortcutTestProviders connection={connection}>
      <SettingsKeyboardShortcutsSection />
    </ShortcutTestProviders>,
  );
  try {
    expect(screen.getByText("This workflow action is not available on this host.")).toBeTruthy();
    const clear = screen.getByRole("button", { name: "Clear shortcut for Toggle sidebar" });
    expect(clear.hasAttribute("disabled")).toBe(false);
    fireEvent.click(clear);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });
    expect(write.mock.calls[0]![0].overrides).toEqual({
      sidebar: null,
      diagnostics: conflict,
      "workflow:unavailable-workflow:start": conflict,
    });
  } finally {
    view.unmount();
  }
});
