/**
 * Text that an input method writes into the hidden xterm.js text field of the terminal page: soft
 * keyboard text, suggestions, dictation, compositions, and the hardware keys that Android input
 * methods turn into text.
 *
 * Android input methods send this text with key code 229. xterm.js then reads the field in a timer
 * and sends the change since the key went down. When the next key arrives before that timer runs,
 * as with fast typing, a hardware key burst, or a busy page, the first timer also sends the second
 * character, and the second timer sends it again: "ls -la" reached the shell as "lss -la-lalaa".
 * xterm.js also sends a composition in a timer, from field positions that a suggestion or a
 * recomposition makes wrong.
 *
 * So the page sends each field change itself, at once and in order, and xterm.js gets no key with
 * key code 229 and no composition event. A change becomes the Delete presses and the text that turn
 * the text sent before into the new field text, so a suggestion or an autocorrection replaces the
 * word in the shell too. xterm.js still sends the keys that it encodes, such as Enter, Backspace,
 * arrows, and shortcuts. The field change of such a key is not sent again.
 */
const DELETE = "\u007f";
const INPUT_METHOD_KEY_CODE = 229;
const COMPOSITION_EVENTS = ["compositionstart", "compositionupdate", "compositionend"] as const;

/**
 * The input that turns the shell line from `sent` into `next`: one Delete for each character after
 * the common start, then the rest of `next`. A line break becomes Enter, as in an xterm.js paste.
 */
export const terminalFieldEdit = (sent: string, next: string): string => {
  const before = Array.from(sent);
  const after = Array.from(next);
  let common = 0;
  while (common < before.length && common < after.length && before[common] === after[common]) {
    common += 1;
  }
  const added = after.slice(common).join("").replace(/\r?\n/g, "\r");
  return DELETE.repeat(before.length - common) + added;
};

/**
 * The state of the text field: the field text that reached the shell, and whether the key that is
 * down already sent its input through xterm.js.
 */
export const createTerminalTextInput = () => {
  let sent = "";
  let key: "none" | "down" | "sent" = "none";
  return {
    /**
     * A key went down. xterm.js reads it, unless it comes from an input method. An input method
     * edit sends only its own change, also after xterm.js changed the field, as a paste does.
     */
    keyDown(fromInputMethod: boolean, value: string): void {
      if (fromInputMethod) sent = value;
      key = fromInputMethod ? "none" : "down";
    },
    /** xterm.js or a page shortcut sent input for the key that is down. */
    keySent(): void {
      if (key === "down") key = "sent";
    },
    /** The field text changed. Returns the input to send, or an empty string. */
    fieldChanged(value: string, inputType: string): string {
      // xterm.js sends a key or a paste itself. The field change only follows it.
      const followsInput = key === "sent" || inputType === "insertFromPaste";
      if (key === "sent") key = "none";
      const edit = followsInput ? "" : terminalFieldEdit(sent, value);
      sent = value;
      return edit;
    },
    /** A key went up. xterm.js empties the field for Enter and Ctrl+C without a field change. */
    keyUp(value: string): void {
      if (key === "sent") sent = value;
      key = "none";
    },
    /**
     * xterm.js changed the field without a field change event: it empties the field when it loses
     * the focus and after a paste.
     */
    replaced(value: string): void {
      sent = value;
      key = "none";
    },
    /**
     * Text in the field was selected. On Linux, which includes Android, xterm.js puts its selection
     * into the field and selects it there for the system clipboard. The shell never got that text,
     * so the field gets back the sent text. Returns that text, or null when the field kept it.
     */
    selected(value: string): string | null {
      return value === sent ? null : sent;
    },
  };
};

type TextField = {
  value: string;
  inputMode: string;
  addEventListener(type: "input", listener: (event: { readonly inputType: string }) => void): void;
  addEventListener(type: "focus" | "blur" | "select", listener: () => void): void;
};
type CompositionTarget = {
  addEventListener(
    type: (typeof COMPOSITION_EVENTS)[number],
    listener: (event: { stopPropagation(): void }) => void,
    options: { capture: boolean },
  ): void;
};
type KeyEvent = { readonly type: string; readonly keyCode: number; readonly isComposing: boolean };
/** The xterm.js terminal members that the text input uses. */
export type TextInputTerminal<Event extends KeyEvent> = {
  readonly textarea: TextField | undefined;
  readonly element: CompositionTarget | undefined;
  input(data: string, wasUserInput: boolean): void;
  onData(listener: (data: string) => void): { dispose(): void };
  attachCustomKeyEventHandler(handler: (event: Event) => boolean): void;
};

/** The text input of one terminal. */
export type TerminalTextInput = {
  /** Call it after `paste` of the terminal, which empties the field. */
  fieldReplaced(): void;
};

/**
 * Sends the input method text of an open terminal through its `onData` event, and gives xterm.js
 * `keyHandler` for the other keys. Call it once, right after `open`.
 */
export const installTerminalTextInput = <Event extends KeyEvent>(
  terminal: TextInputTerminal<Event>,
  keyHandler: (event: Event) => boolean,
): TerminalTextInput => {
  const field = terminal.textarea;
  const element = terminal.element;
  if (field === undefined || element === undefined) {
    throw new Error("The terminal has no text field. Install the text input after open.");
  }
  const state = createTerminalTextInput();
  field.inputMode = "none";
  field.addEventListener("blur", () => {
    field.inputMode = "none";
  });
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type === "keydown") {
      const fromInputMethod = event.keyCode === INPUT_METHOD_KEY_CODE || event.isComposing;
      state.keyDown(fromInputMethod, field.value);
      if (fromInputMethod) return false;
    }
    if (event.type === "keyup") state.keyUp(field.value);
    const passToXterm = keyHandler(event);
    if (!passToXterm && event.type === "keydown") state.keySent();
    return passToXterm;
  });
  terminal.onData(() => state.keySent());
  // The text field is inside the terminal element, so xterm.js never gets these events.
  for (const type of COMPOSITION_EVENTS) {
    element.addEventListener(type, (event) => event.stopPropagation(), { capture: true });
  }
  field.addEventListener("input", (event) => {
    const data = state.fieldChanged(field.value, event.inputType);
    if (data.length > 0) terminal.input(data, true);
  });
  field.addEventListener("focus", () => state.replaced(field.value));
  field.addEventListener("select", () => {
    const sent = state.selected(field.value);
    if (sent !== null) field.value = sent;
  });
  return { fieldReplaced: () => state.replaced(field.value) };
};
