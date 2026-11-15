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
    expect(screen.getByRole("textbox", { name: "Search commands" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.getByRole("button", { name: "Shortcut category" }).hasAttribute("disabled")).toBe(
      true,
    );
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

test("combines category and search filters without changing saved shortcuts", async () => {
  const write = mock(async (preferences: ShortcutPreferences) => preferences);
  const connection = createTestClientConnection({
    client: { workspaceSaveKeyboardShortcuts: write },
  });
  connection.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides: {} });
  const view = render(
    <ShortcutTestProviders connection={connection}>
      <SettingsKeyboardShortcutsSection />
    </ShortcutTestProviders>,
  );
  try {
    fireEvent.click(screen.getByRole("button", { name: "Shortcut category" }));
    fireEvent.click(screen.getByRole("option", { name: "Workspace" }));
    expect(screen.queryByRole("button", { name: "Record shortcut for Toggle sidebar" })).toBeNull();
    expect(screen.getByRole("button", { name: "Record shortcut for New task" })).toBeTruthy();
    fireEvent.change(screen.getByRole("textbox", { name: "Search commands" }), {
      target: { value: "Toggle sidebar" },
    });
    expect(screen.getByRole("status").textContent).toContain("No shortcuts found");
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(screen.getByRole("button", { name: "Record shortcut for New task" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Record shortcut for Toggle sidebar" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Shortcut category" }));
    fireEvent.click(screen.getByRole("option", { name: "All categories" }));
    expect(screen.getByRole("button", { name: "Record shortcut for Toggle sidebar" })).toBeTruthy();
    expect(write).not.toHaveBeenCalled();
  } finally {
    view.unmount();
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
