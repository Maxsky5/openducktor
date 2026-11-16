import { createShortcutLabelStore } from "@/features/shortcuts/shortcut-label-store";
import { CommandPaletteRegistryContext } from "@/features/command-palette/command-palette-registry";
import { expect, mock, test } from "bun:test";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  CommandPaletteContext,
  type CommandPaletteContextValue,
} from "@/features/command-palette/command-palette-context";
import type { CommandPalettePageCommand } from "@/features/command-palette/command-palette-types";
import { SessionViewContext } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { SessionViewControls } from "./session-view-controls";

/** A palette that keeps the page commands that are registered now. */
const recordingPalette = (shortcutLabel?: (id: string) => string | null) => {
  const commands = new Map<string, CommandPalettePageCommand>();
  const value: CommandPaletteContextValue = { open: () => {}, platform: null };
  const registerPageCommand = (command: CommandPalettePageCommand) => {
    commands.set(command.id, command);
    return () => {
      if (commands.get(command.id) === command) commands.delete(command.id);
    };
  };

  const wrap = (element: ReactElement): ReactElement => {
    const shortcutLabels = createShortcutLabelStore();
    shortcutLabels.replace(
      new Map(
        (["bottom-panel", "right-panel"] as const).flatMap((id) => {
          const label = shortcutLabel?.(id);
          return label ? [[id, { label, keys: [], aria: "", owner: null }]] : [];
        }),
      ),
    );
    return (
      <CommandPaletteRegistryContext
        value={{
          pageCommands: [],
          listedCommands: [],
          shortcutLabels,
          subscribe: () => () => {},
          invalidatePageCommands: () => {},
          registerPageCommand,
        }}
      >
        <CommandPaletteContext value={value}>{element}</CommandPaletteContext>
      </CommandPaletteRegistryContext>
    );
  };
  return { commands, wrap };
};

test("updates panel toggle tooltips after remap or clear and hides inactive assignments", async () => {
  let label: string | null = "Ctrl+J";
  const { wrap } = recordingPalette(() => label);
  const controls = (available = true) =>
    wrap(
      <SessionViewControls
        bottom={{ isAvailable: available, isOpen: false, onToggle: () => {} }}
        right={null}
      />,
    );
  const view = render(controls());
  await act(async () => fireEvent.focus(screen.getByRole("button", { name: "Show bottom panel" })));
  expect(screen.getByRole("tooltip").textContent).toBe("Show bottom panel Ctrl+J");
  label = "Ctrl+Shift+J";
  view.rerender(controls());
  expect(screen.getByRole("tooltip").textContent).toBe("Show bottom panel Ctrl+Shift+J");
  label = null;
  view.rerender(controls());
  expect(screen.getByRole("tooltip").textContent).toBe("Show bottom panel");
  label = "Ctrl+J";
  view.rerender(controls(false));
  expect(screen.getByRole("tooltip").textContent).toBe("Show bottom panel");
});

test("toggles the bottom panel and the right panel from the session top bar", () => {
  const onBottomToggle = mock(() => {});
  const onRightToggle = mock(() => {});
  const { wrap } = recordingPalette();
  const view = render(
    wrap(
      <SessionViewControls
        bottom={{ isAvailable: true, isOpen: false, onToggle: onBottomToggle }}
        right={{ isOpen: true, onToggle: onRightToggle }}
      />,
    ),
  );

  fireEvent.click(screen.getByRole("button", { name: "Show bottom panel" }));
  fireEvent.click(screen.getByRole("button", { name: "Hide right panel" }));

  expect(onBottomToggle).toHaveBeenCalledTimes(1);
  expect(onRightToggle).toHaveBeenCalledTimes(1);
  expect(
    screen.getByRole("button", { name: "Hide right panel" }).getAttribute("aria-pressed"),
  ).toBe("true");

  view.rerender(
    wrap(
      <SessionViewControls
        bottom={{ isAvailable: false, isOpen: false, onToggle: onBottomToggle }}
        right={null}
      />,
    ),
  );

  expect(screen.getByRole("button", { name: "Show bottom panel" }).hasAttribute("disabled")).toBe(
    true,
  );
  expect(screen.queryByRole("button", { name: /right panel/ })).toBeNull();
});

test("adds a palette command for each panel that the page can toggle", () => {
  const onBottomToggle = mock(() => {});
  const { commands, wrap } = recordingPalette();
  const view = render(
    wrap(
      <SessionViewControls
        bottom={{ isAvailable: true, isOpen: true, onToggle: onBottomToggle }}
        right={{ isOpen: false, onToggle: () => {} }}
      />,
    ),
  );

  expect([...commands.values()].map((command) => command.label)).toEqual([
    "Hide bottom panel",
    "Show right panel",
  ]);
  commands.get("bottom-panel")?.run();
  expect(onBottomToggle).toHaveBeenCalledTimes(1);

  view.rerender(
    wrap(
      <SessionViewControls
        bottom={{ isAvailable: false, isOpen: false, onToggle: onBottomToggle }}
        right={null}
      />,
    ),
  );
  expect(commands.size).toBe(0);
});

test("only the active session view adds the palette commands", () => {
  const { commands, wrap } = recordingPalette();
  const controls = (isActive: boolean) =>
    wrap(
      <SessionViewContext value={{ id: "kept", isActive }}>
        <SessionViewControls
          bottom={{ isAvailable: true, isOpen: false, onToggle: () => {} }}
          right={{ isOpen: false, onToggle: () => {} }}
        />
      </SessionViewContext>,
    );
  const view = render(controls(false));

  expect(screen.getByRole("button", { name: "Show bottom panel" })).toBeTruthy();
  expect(commands.size).toBe(0);

  view.rerender(controls(true));
  expect([...commands.keys()]).toEqual(["bottom-panel", "right-panel"]);
});
