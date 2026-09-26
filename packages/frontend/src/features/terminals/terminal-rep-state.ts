import type { Terminal } from "@xterm/xterm";

type XtermParser = { precedingJoinState: number };
type XtermWithParser = Terminal & {
  _core?: { _inputHandler?: { _parser?: XtermParser } };
};

export const restoreTerminalPrecedingJoinState = (terminal: Terminal, state: number): void => {
  // SAFETY: xterm 6.0.0 stores REP state on its parser. Restore tests pin this field.
  const parser = (terminal as XtermWithParser)._core?._inputHandler?._parser;
  if (!parser || !Number.isInteger(parser.precedingJoinState)) {
    throw new Error("Terminal parser state is unavailable. Reload OpenDucktor and reconnect.");
  }
  parser.precedingJoinState = state;
};
