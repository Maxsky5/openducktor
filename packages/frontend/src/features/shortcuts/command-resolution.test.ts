import { expect, spyOn, test } from "bun:test";
import { Command } from "lucide-react";
import type { CommandPalettePageCommand } from "../command-palette/command-palette-types";
import { resolvePageCommand } from "./command-resolution";

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
    expect(resolvePageCommand([...unrelated, command], command.id, focus, false)).toBe(command);
    expect(focusReads).toHaveBeenCalledTimes(1);
  } finally {
    focusReads.mockRestore();
    focus.remove();
  }
});
