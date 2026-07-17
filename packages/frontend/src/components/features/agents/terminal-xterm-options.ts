import type { ITerminalOptions, ITheme } from "@xterm/xterm";
import { TERMINAL_FONT_FAMILY } from "./terminal-font";

const readCssVariable = (element: HTMLElement, name: string): string =>
  getComputedStyle(element).getPropertyValue(name).trim();

export const createTerminalTheme = (container: HTMLElement): ITheme => ({
  background: readCssVariable(container, "--dev-server-terminal-panel"),
  foreground: readCssVariable(container, "--dev-server-terminal-foreground"),
  cursor: readCssVariable(container, "--dev-server-terminal-foreground"),
  cursorAccent: readCssVariable(container, "--dev-server-terminal-panel"),
  selectionBackground: readCssVariable(container, "--dev-server-terminal-selection"),
  selectionInactiveBackground: readCssVariable(
    container,
    "--dev-server-terminal-selection-inactive",
  ),
});

export const createTerminalOptions = (
  container: HTMLElement,
  options: Partial<ITerminalOptions>,
): ITerminalOptions => ({
  allowTransparency: true,
  convertEol: false,
  fontFamily: TERMINAL_FONT_FAMILY,
  fontSize: 12,
  lineHeight: 1.35,
  scrollback: 2000,
  theme: createTerminalTheme(container),
  ...options,
});
