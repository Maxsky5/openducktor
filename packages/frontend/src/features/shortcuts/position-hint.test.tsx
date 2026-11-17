import { ShortcutLabels } from "@/test-utils/shortcut-labels";
import { expect, test } from "bun:test";
import { render } from "@testing-library/react";
import type { AppPlatform } from "@openducktor/contracts";
import { CommandPaletteContext } from "../command-palette/command-palette-context";
import { PositionHint } from "./position-hint";

test.each([
  { platform: "darwin", family: "workspace", position: 1, label: "⇧⌘1", hint: "⇧ 1" },
  {
    platform: "win32",
    family: "workspace",
    position: 10,
    label: "Ctrl+Shift+0",
    hint: "Shift 0",
  },
  { platform: "darwin", family: "session", position: 10, label: "⌘0", hint: "0" },
  { platform: "darwin", family: "workspace", position: 2, label: "Ctrl+F9", hint: "Ctrl+F9" },
  { platform: "darwin", family: "workspace", position: 2, label: null, hint: "—" },
  { platform: "darwin", family: "session", position: 11, label: null, hint: "11" },
] satisfies {
  platform: AppPlatform;
  family: "workspace" | "session";
  position: number;
  label: string | null;
  hint: string;
}[])("shows $family position $position as $hint on $platform", (item) => {
  const view = render(
    <ShortcutLabels labels={{ [`${item.family}-position-${item.position}`]: item.label }}>
      <CommandPaletteContext
        value={{
          platform: item.platform,
          open: () => {},
        }}
      >
        <PositionHint family={item.family} position={item.position} />
      </CommandPaletteContext>
    </ShortcutLabels>,
  );
  try {
    expect(view.container.textContent).toBe(item.hint);
    expect(view.container.firstElementChild?.getAttribute("title")).toBe(
      item.position <= 10 ? (item.label ?? "Unassigned") : null,
    );
  } finally {
    view.unmount();
  }
});
