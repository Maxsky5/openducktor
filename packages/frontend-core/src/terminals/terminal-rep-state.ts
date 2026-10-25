/** The private xterm 6.0.0 field that keeps the REP (repeat preceding character) parser state. */
type XtermWithParser = {
  _core?: { _inputHandler?: { _parser?: { precedingJoinState: number } } };
};

/**
 * Restores the REP parser state that a host screen restore reports. Pass an xterm 6.0.0
 * `Terminal`. The function has no xterm type, so platform-independent code can share it.
 */
export const restoreTerminalPrecedingJoinState = <Terminal>(
  terminal: Terminal,
  state: number,
): void => {
  // SAFETY: xterm 6.0.0 stores REP state on its parser. Restore tests pin this field.
  const parser = (terminal as XtermWithParser)._core?._inputHandler?._parser;
  if (!parser || !Number.isInteger(parser.precedingJoinState)) {
    throw new Error("Terminal parser state is unavailable. Reload OpenDucktor and reconnect.");
  }
  parser.precedingJoinState = state;
};
