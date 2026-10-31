import { afterEach, describe, expect, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  createTerminalTextInput,
  installTerminalTextInput,
  terminalFieldEdit,
} from "./terminal-text-input";

if (globalThis.document === undefined) GlobalRegistrator.register();

const { Terminal } = await import("@xterm/xterm");

const DELETE = "\u007f";

describe("terminalFieldEdit", () => {
  test("sends the added text, and a Delete for each removed character", () => {
    expect(terminalFieldEdit("ech", "echo ")).toBe("o ");
    expect(terminalFieldEdit("echo", "ech")).toBe(DELETE);
    expect(terminalFieldEdit("teh", "the ")).toBe(`${DELETE}${DELETE}he `);
    expect(terminalFieldEdit("same", "same")).toBe("");
  });

  test("counts characters, not UTF-16 units", () => {
    expect(terminalFieldEdit("a😀", "a")).toBe(DELETE);
    expect(terminalFieldEdit("a😀", "a😃")).toBe(`${DELETE}😃`);
  });

  test("turns line breaks into Enter", () => {
    expect(terminalFieldEdit("", "one\ntwo\r\n")).toBe("one\rtwo\r");
  });
});

describe("createTerminalTextInput", () => {
  test("does not send the field change of a key that xterm.js sent", () => {
    const input = createTerminalTextInput();
    input.keyDown(false, "");
    input.keySent();
    expect(input.fieldChanged("a", "insertText")).toBe("");
    input.keyUp("a");
    expect(input.fieldChanged("ab", "insertText")).toBe("b");
  });

  test("sends the field change of a key that xterm.js did not send", () => {
    const input = createTerminalTextInput();
    input.keyDown(false, "");
    expect(input.fieldChanged("é", "insertText")).toBe("é");
  });
});

type TestTerminal = InstanceType<typeof Terminal>;
const opened: TestTerminal[] = [];

afterEach(() => {
  for (const terminal of opened.splice(0)) terminal.dispose();
  document.body.innerHTML = "";
});

/** An open xterm.js terminal with the page options and the text input, and the input it sent. */
const openTerminal = (keyHandler: (event: KeyboardEvent) => boolean = () => true) => {
  const parent = document.createElement("div");
  document.body.append(parent);
  const terminal = new Terminal({ cols: 40, rows: 4, screenReaderMode: true });
  opened.push(terminal);
  terminal.open(parent);
  const textInput = installTerminalTextInput(terminal, keyHandler);
  const sent: string[] = [];
  terminal.onData((data) => sent.push(data));
  const field = terminal.textarea;
  if (field === undefined) throw new Error("The terminal has no text field.");
  field.focus();
  return { terminal, textInput, field, sent };
};

type Field = HTMLTextAreaElement;
const key = (field: Field, type: "keydown" | "keyup", keyCode: number, key: string) =>
  field.dispatchEvent(new KeyboardEvent(type, { key, keyCode, bubbles: true, cancelable: true }));
/** The field change of the browser: the new text, then an `input` event. */
const change = (field: Field, value: string, inputType: string, data: string | null = null) => {
  field.value = value;
  field.dispatchEvent(new InputEvent("input", { inputType, data, bubbles: true }));
};
const composition = (field: Field, type: string, data: string) =>
  field.dispatchEvent(new CompositionEvent(type, { data, bubbles: true }));
/** Gboard text: key code 229 around the field change. */
const inputMethodText = (field: Field, text: string) => {
  key(field, "keydown", 229, "Unidentified");
  change(field, field.value + text, "insertText", text);
  key(field, "keyup", 229, "Unidentified");
};
/** xterm.js reads the field in timers. The test waits until they ran. */
const timersRan = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("the terminal page text input", () => {
  test("output focus keeps the soft keyboard closed and blur ends keyboard input", () => {
    const { field } = openTerminal();
    expect(field.inputMode).toBe("none");
    field.inputMode = "text";
    field.blur();
    expect(field.inputMode).toBe("none");
    field.focus();
    expect(field.inputMode).toBe("none");
  });

  test("sends each soft keyboard character once, also when keys come faster than timers", async () => {
    const { field, sent } = openTerminal();
    for (const character of "echo auc") inputMethodText(field, character);
    await timersRan();
    expect(sent.join("")).toBe("echo auc");
  });

  test("sends each key of an adb text burst once", async () => {
    // Gboard turns each injected key into text, and the page then gets the key up of the key.
    const { field, sent } = openTerminal();
    for (const character of "ls -la") {
      inputMethodText(field, character);
      key(field, "keyup", character.toUpperCase().charCodeAt(0), character);
    }
    await timersRan();
    expect(sent).toEqual(["l", "s", " ", "-", "l", "a"]);
  });

  test("sends Backspace once when the browser also deletes in the field", async () => {
    const { field, sent } = openTerminal();
    for (const character of "ls") inputMethodText(field, character);
    key(field, "keydown", 8, "Backspace");
    change(field, "l", "deleteContentBackward");
    key(field, "keyup", 8, "Backspace");
    // Backspace in an empty field changes nothing.
    key(field, "keydown", 8, "Backspace");
    change(field, "", "deleteContentBackward");
    key(field, "keyup", 8, "Backspace");
    key(field, "keydown", 8, "Backspace");
    key(field, "keyup", 8, "Backspace");
    await timersRan();
    expect(sent).toEqual(["l", "s", DELETE, DELETE, DELETE]);
  });

  test("sends a deletion of the input method as Delete", async () => {
    const { field, sent } = openTerminal();
    for (const character of "echo") inputMethodText(field, character);
    key(field, "keydown", 229, "Unidentified");
    change(field, "ech", "deleteContentBackward");
    key(field, "keyup", 229, "Unidentified");
    await timersRan();
    expect(sent.join("")).toBe(`echo${DELETE}`);
  });

  test("sends the rest of a suggestion and the change of an autocorrection", async () => {
    const { field, sent } = openTerminal();
    for (const character of "ech") inputMethodText(field, character);
    // The Gboard suggestion "echo" adds the end of the word and a space.
    inputMethodText(field, "o ");
    for (const character of "teh") inputMethodText(field, character);
    key(field, "keydown", 229, "Unidentified");
    change(field, "echo the ", "insertReplacementText", "the ");
    key(field, "keyup", 229, "Unidentified");
    await timersRan();
    expect(sent.join("")).toBe(`echo teh${DELETE}${DELETE}he `);
  });

  test("sends Enter once and no line break after it", async () => {
    const { field, sent } = openTerminal();
    for (const character of "ls") inputMethodText(field, character);
    key(field, "keydown", 13, "Enter");
    change(field, `${field.value}\n`, "insertLineBreak");
    key(field, "keyup", 13, "Enter");
    for (const character of "pwd") inputMethodText(field, character);
    await timersRan();
    expect(sent.join("")).toBe("ls\rpwd");
  });

  test("sends a composition as it changes, and never again when it ends", async () => {
    const { field, sent } = openTerminal();
    key(field, "keydown", 229, "Unidentified");
    composition(field, "compositionstart", "");
    for (const word of ["l", "ls"]) {
      composition(field, "compositionupdate", word);
      change(field, word, "insertCompositionText", word);
    }
    // Space commits the word, and the next word starts.
    change(field, "ls ", "insertText", " ");
    composition(field, "compositionend", "ls");
    key(field, "keyup", 229, "Unidentified");
    // A recomposition of the earlier word replaces it.
    composition(field, "compositionstart", "");
    composition(field, "compositionupdate", "la");
    change(field, "la", "insertCompositionText", "la");
    composition(field, "compositionend", "la");
    await timersRan();
    expect(sent.join("")).toBe(`ls ${DELETE}${DELETE}a`);
  });

  test("sends a hardware key once when the browser also writes it into the field", async () => {
    const { field, sent } = openTerminal();
    key(field, "keydown", 65, "a");
    change(field, "a", "insertText", "a");
    key(field, "keyup", 65, "a");
    inputMethodText(field, "b");
    await timersRan();
    expect(sent).toEqual(["a", "b"]);
  });

  test("does not send the field change of a page shortcut again", async () => {
    // A page shortcut sends its own input, such as Alt+Backspace, and the browser deletes a word.
    const { field, sent } = openTerminal((event) => !(event.type === "keydown" && event.altKey));
    for (const character of "ls la") inputMethodText(field, character);
    field.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Backspace", keyCode: 8, altKey: true, bubbles: true }),
    );
    change(field, "ls ", "deleteWordBackward");
    key(field, "keyup", 8, "Backspace");
    inputMethodText(field, "x");
    await timersRan();
    expect(sent.join("")).toBe("ls lax");
  });

  test("sends only new text after a paste emptied the field", async () => {
    const { terminal, textInput, field, sent } = openTerminal();
    for (const character of "ls") inputMethodText(field, character);
    terminal.paste(" -la");
    inputMethodText(field, "x");
    terminal.paste(" -h");
    textInput.fieldReplaced();
    // Dictation changes the field without a key.
    change(field, " y", "insertText", " y");
    await timersRan();
    expect(sent.join("")).toBe("ls -lax -h y");
  });

  test("gives the field back its text when xterm.js puts its selection there", async () => {
    // A double tap selects a word. On Linux, which includes Android, xterm.js then copies the word
    // into the field and selects it there. Typing replaces that word in the field only.
    const { field, sent } = openTerminal();
    for (const character of "ls") inputMethodText(field, character);
    field.value = "fast";
    field.select();
    field.dispatchEvent(new Event("select"));
    expect(field.value).toBe("ls");
    inputMethodText(field, "x");
    await timersRan();
    expect(sent.join("")).toBe("lsx");
  });

  test("starts from the empty field after the focus came back", async () => {
    const { field, sent } = openTerminal();
    for (const character of "ls") inputMethodText(field, character);
    field.blur();
    field.focus();
    inputMethodText(field, "x");
    await timersRan();
    expect(sent.join("")).toBe("lsx");
  });
});
