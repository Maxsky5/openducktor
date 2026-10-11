import type { PropsWithChildren, ReactElement } from "react";
import {
  CommandPaletteContext,
  type CommandPaletteContextValue,
} from "@/features/command-palette/command-palette-context";

const TEST_COMMAND_PALETTE: CommandPaletteContextValue = {
  open: () => {},
  registerPageCommand: () => () => {},
  platform: null,
};

/** A closed palette for components that add page commands outside the app shell. */
export function CommandPaletteTestContext({ children }: PropsWithChildren): ReactElement {
  return <CommandPaletteContext value={TEST_COMMAND_PALETTE}>{children}</CommandPaletteContext>;
}
