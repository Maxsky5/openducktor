import type { AppTheme } from "@/theme/tokens";
import type { TerminalPageColors } from "@/rich-content/isolated-page/terminal-page-messages";

/**
 * The terminal colors of the theme. They match the desktop xterm.js theme: the terminal panel
 * background, the terminal foreground for text and cursor, and the terminal selection. Desktop
 * keeps the default xterm.js ANSI palette, so the page does too.
 */
export const terminalPageColors = ({
  terminalPanel,
  terminalForeground,
  terminalSelection,
}: Pick<
  AppTheme["colors"],
  "terminalPanel" | "terminalForeground" | "terminalSelection"
>): TerminalPageColors => ({
  background: terminalPanel,
  foreground: terminalForeground,
  cursor: terminalForeground,
  cursorAccent: terminalPanel,
  selection: terminalSelection,
});

/** Desktop terminals use 12 px text. The page follows the system text size from there. */
export const terminalFontSize = (fontScale: number): number =>
  Math.min(28, Math.max(8, Math.round(12 * fontScale)));
