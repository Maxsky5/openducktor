import { expect, mock, test } from "bun:test";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import {
  CommandPaletteContext,
  type CommandPaletteContextValue,
} from "@/features/command-palette/command-palette-context";
import type { CommandPalettePageCommand } from "@/features/command-palette/command-palette-types";
import { SessionViewContext } from "@openducktor/frontend-core/sessions/navigation/session-view-context";
import { SessionViewControls } from "./session-view-controls";

/** A palette that keeps the page commands that are registered now. */
const recordingPalette = () => {
  const commands = new Map<string, CommandPalettePageCommand>();
  const value: CommandPaletteContextValue = {
    open: () => {},
    platform: null,
    registerPageCommand: (command) => {
      commands.set(command.id, command);
      return () => {
        if (commands.get(command.id) === command) commands.delete(command.id);
      };
    },
  };
  const wrap = (element: ReactElement): ReactElement => (
    <CommandPaletteContext value={value}>{element}</CommandPaletteContext>
  );
  return { commands, wrap };
};

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
