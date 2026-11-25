import { AgentChatForkButton } from "@/components/features/agents/agent-chat/agent-chat-fork-actions";
import { AgentChatForkActionsContext } from "@/components/features/agents/agent-chat/agent-chat-fork-context";
import { expect, test, spyOn } from "bun:test";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import type { ShortcutPreferences } from "@openducktor/contracts";
import { ShortcutTestProviders } from "@/test-utils/shortcut-providers";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { setupTestingLibraryFakeTimers } from "@openducktor/frontend-core/test-support/testing-library-fake-timers";
import { SidebarNavigation } from "@/components/layout/sidebar/sidebar-navigation";
import { useCommandPalettePageCommands } from "../command-palette/command-palette-context";
import { ShortcutButton } from "./shortcut-controls";
import { useShortcutDispatch } from "./use-shortcut-dispatch";
import { useShortcutPreferences } from "./use-shortcut-preferences";

setupTestingLibraryFakeTimers();

test("shared controls follow committed assignments across the palette subtree and clear stale labels", async () => {
  const writes: { preferences: ShortcutPreferences; resolve(value: ShortcutPreferences): void }[] =
    [];
  const connection = createTestClientConnection({
    client: {
      workspaceSaveKeyboardShortcuts: (preferences) =>
        new Promise((resolve) => writes.push({ preferences, resolve })),
    },
  });
  connection.queryClient.setQueryData(["keyboard-shortcuts"], { version: 1, overrides: {} });
  const ids = ["new-task", "kanban"] as const;
  const remapped: ShortcutPreferences = {
    version: 1,
    overrides: Object.fromEntries(
      ids.map((id, index) => [
        id,
        {
          key: { kind: "logical", key: `F${index + 9}` },
          mod: false,
          ctrl: true,
          alt: false,
          shift: true,
        },
      ]),
    ),
  };
  const appCommands = ids.map((id) => ({ id, run: () => {}, localOnly: true, appWide: true }));
  function RoutingOwner() {
    useCommandPalettePageCommands(appCommands);
    useShortcutDispatch({
      platform: "linux",
      isOpen: false,
      open: () => {},
      close: () => {},
      runAfterClose: (run) => run(),
    });
    const { save } = useShortcutPreferences();
    return (
      <>
        <button onClick={() => save.mutate(remapped)}>Remap</button>
        <button
          onClick={() =>
            save.mutate({ version: 1, overrides: Object.fromEntries(ids.map((id) => [id, null])) })
          }
        >
          Clear assignments
        </button>
      </>
    );
  }
  const tree = (ownerKey: number) => (
    <ShortcutTestProviders connection={connection}>
      <MemoryRouter>
        <RoutingOwner key={ownerKey} />
        <SidebarNavigation />
        <ShortcutButton shortcutId="new-task" title="New task">
          Create
        </ShortcutButton>
        <ShortcutButton shortcutId="new-task" title="Unavailable task" disabled>
          Unavailable
        </ShortcutButton>
      </MemoryRouter>
    </ShortcutTestProviders>
  );
  const view = render(tree(0));
  try {
    await waitFor(() =>
      expect(screen.getByRole("link", { name: "Kanban" }).title).toBe("Kanban (Ctrl+G)"),
    );
    const create = screen.getByRole("button", { name: "Create" });
    expect(create.title).toBe("New task (Ctrl+O)");
    view.rerender(tree(1));
    await waitFor(() => expect(create.title).toBe("New task (Ctrl+O)"), { timeout: 300 });
    expect(screen.getByRole("button", { name: "Unavailable" }).title).toBe("Unavailable task");
    fireEvent.click(screen.getByRole("button", { name: "Remap" }));
    await waitFor(() => expect(writes.length).toBe(1));
    expect(create.title).toBe("New task (Ctrl+O)");
    await act(async () => {
      writes[0]!.resolve(writes[0]!.preferences);
    });
    await waitFor(() => expect(create.title).toBe("New task (Ctrl+Shift+F9)"));
    expect(screen.getByRole("link", { name: "Kanban" }).title).toBe("Kanban (Ctrl+Shift+F10)");
    fireEvent.click(screen.getByRole("button", { name: "Clear assignments" }));
    await waitFor(() => expect(writes.length).toBe(2));
    await act(async () => {
      writes[1]!.resolve(writes[1]!.preferences);
    });
    await waitFor(() => expect(create.title).toBe("New task"));
    expect(screen.getByRole("link", { name: "Kanban" }).title).toBe("Kanban");
  } finally {
    view.unmount();
  }
});

test("only the focused message advertises and receives its fork shortcut", async () => {
  const connection = createTestClientConnection();
  connection.queryClient.setQueryData(["keyboard-shortcuts"], {
    version: 1,
    overrides: {
      "message-fork": {
        key: { kind: "logical", key: "F9" },
        ctrl: true,
        mod: false,
        alt: false,
        shift: true,
      },
    },
  });
  const calls: string[] = [];
  function Routing() {
    useShortcutDispatch({
      platform: "linux",
      isOpen: false,
      open: () => {},
      close: () => {},
      runAfterClose: (run) => run(),
    });
    return null;
  }
  const view = render(
    <ShortcutTestProviders connection={connection}>
      <Routing />
      <AgentChatForkActionsContext
        value={{
          disabledReason: null,
          isPending: () => false,
          onFork: (point) => calls.push(point.messageId),
        }}
      >
        {["A", "B"].map((id) => (
          <div key={id} data-message-owner tabIndex={-1} data-testid={`message-${id}`}>
            <AgentChatForkButton point={{ messageId: id }} />
          </div>
        ))}
      </AgentChatForkActionsContext>
    </ShortcutTestProviders>,
  );
  const buttons = screen.getAllByRole("button", { name: "Fork from this reply" });
  const rects = buttons.map((button) =>
    spyOn(button.parentElement!, "getClientRects").mockReturnValue({
      0: new DOMRect(),
      length: 1,
      item: () => new DOMRect(),
      [Symbol.iterator]: () => [new DOMRect()][Symbol.iterator](),
    }),
  );
  try {
    act(() => screen.getByTestId("message-A").focus());
    await waitFor(() => expect(buttons[0]!.title).toContain("Ctrl+Shift+F9"));
    expect(buttons[1]!.title).not.toContain("Ctrl+Shift+F9");
    fireEvent.pointerMove(buttons[1]!, { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).not.toContain("Ctrl+Shift+F9");
    fireEvent.pointerLeave(buttons[1]!, { pointerType: "mouse" });
    expect(fireEvent.keyDown(window, { key: "F9", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(calls).toEqual(["A"]);
    act(() => screen.getByTestId("message-B").focus());
    await waitFor(() => expect(buttons[1]!.title).toContain("Ctrl+Shift+F9"));
    expect(buttons[0]!.title).not.toContain("Ctrl+Shift+F9");
    fireEvent.pointerMove(buttons[1]!, { pointerType: "mouse" });
    expect((await screen.findByRole("tooltip")).textContent).toContain("Ctrl+Shift+F9");
    fireEvent.pointerLeave(buttons[1]!, { pointerType: "mouse" });
    expect(fireEvent.keyDown(window, { key: "F9", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(calls).toEqual(["A", "B"]);
  } finally {
    view.unmount();
    rects.forEach((spy) => spy.mockRestore());
  }
});
