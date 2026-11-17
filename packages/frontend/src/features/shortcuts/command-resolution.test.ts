import { expect, spyOn, test } from "bun:test";
import { Command } from "lucide-react";
import type { CommandPalettePageCommand } from "../command-palette/command-palette-types";
import { commandDefinition } from "./catalogue";
import { isTyping, paletteCommandsFor, resolvePageCommand } from "./command-resolution";

test("resolving a command checks focus once, regardless of unrelated registrations", () => {
  const focus = document.createElement("button");
  document.body.append(focus);
  const focusReads = spyOn(focus, "closest");
  const command: CommandPalettePageCommand = {
    id: "task-edit",
    label: "Edit task",
    icon: Command,
    keywords: [],
    run: () => {},
  };
  const unrelated = Array.from({ length: 100 }, (_, index) => ({
    ...command,
    id: "task-delete" as const,
    target: { kind: "task" as const, key: `unrelated-${index}` },
  }));
  try {
    expect(
      resolvePageCommand([...unrelated, command], commandDefinition("task-edit")!, focus, {
        palette: false,
        typing: isTyping(focus, false, false),
      }),
    ).toBe(command);
    expect(focusReads).toHaveBeenCalledTimes(1);
  } finally {
    focusReads.mockRestore();
    focus.remove();
  }
});

test("the palette lists page commands, never the commands of its highlighted record", () => {
  const command = (
    id: CommandPalettePageCommand["id"],
    key: string,
    paletteOnly = false,
  ): CommandPalettePageCommand => ({
    id,
    label: id,
    icon: Command,
    keywords: [],
    target: { kind: "task", key },
    paletteOnly,
    run: () => {},
  });
  const visibleTask = command("task-edit", "visible");
  const highlighted = [
    command("task-edit", "highlighted", true),
    command("task-delete", "highlighted", true),
  ];
  // Listing the highlighted record's commands moved the highlight, which unregistered them, and
  // the palette rerendered until React stopped it.
  expect(paletteCommandsFor([visibleTask, ...highlighted], null)).toEqual([visibleTask]);
  expect(paletteCommandsFor(highlighted, null)).toEqual([]);
});
