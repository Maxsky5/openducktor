import type { AppPlatform } from "@openducktor/contracts";

const TERMINAL_INPUT = {
  interrupt: [3],
  killNextWord: [27, 100],
  killPreviousWord: [23],
  killToLineStart: [21],
  lineEnd: [5],
  lineStart: [1],
  nextWord: [27, 102],
  previousWord: [27, 98],
} as const;

/** The key event fields that the policy reads. A DOM `KeyboardEvent` has them. */
export type TerminalKeyEvent = {
  readonly altKey: boolean;
  readonly ctrlKey: boolean;
  readonly key: string;
  readonly metaKey: boolean;
  readonly shiftKey: boolean;
  readonly type: string;
};

type TerminalKeyChord = {
  key: string;
  altKey?: true;
  ctrlKey?: true;
  metaKey?: true;
  shiftKey?: true;
};

type TerminalInputBinding = TerminalKeyChord & {
  bytes: readonly number[];
};

export type TerminalKeyAction =
  | { type: "copy" }
  | { type: "input"; bytes: readonly number[] }
  | { type: "paste" }
  | { type: "passthrough" };

const NON_MACOS_COPY_CHORDS = [
  { key: "c", ctrlKey: true },
  { key: "c", ctrlKey: true, shiftKey: true },
] as const satisfies readonly TerminalKeyChord[];

const NON_MACOS_PASTE_CHORDS = [
  { key: "v", ctrlKey: true, shiftKey: true },
] as const satisfies readonly TerminalKeyChord[];

const COPY_CHORDS_BY_PLATFORM = {
  darwin: [{ key: "c", metaKey: true }],
  linux: NON_MACOS_COPY_CHORDS,
  win32: NON_MACOS_COPY_CHORDS,
} as const satisfies Record<AppPlatform, readonly TerminalKeyChord[]>;

const PASTE_CHORDS_BY_PLATFORM = {
  darwin: [{ key: "v", metaKey: true }],
  linux: NON_MACOS_PASTE_CHORDS,
  win32: NON_MACOS_PASTE_CHORDS,
} as const satisfies Record<AppPlatform, readonly TerminalKeyChord[]>;

const LINE_EDITING_BINDINGS_BY_PLATFORM = {
  darwin: [
    { bytes: TERMINAL_INPUT.lineStart, key: "arrowleft", metaKey: true },
    { bytes: TERMINAL_INPUT.lineEnd, key: "arrowright", metaKey: true },
    { bytes: TERMINAL_INPUT.killToLineStart, key: "backspace", metaKey: true },
    { altKey: true, bytes: TERMINAL_INPUT.previousWord, key: "arrowleft" },
    { altKey: true, bytes: TERMINAL_INPUT.nextWord, key: "arrowright" },
  ],
  linux: [
    { bytes: TERMINAL_INPUT.previousWord, ctrlKey: true, key: "arrowleft" },
    { bytes: TERMINAL_INPUT.nextWord, ctrlKey: true, key: "arrowright" },
    { bytes: TERMINAL_INPUT.killPreviousWord, ctrlKey: true, key: "backspace" },
    { bytes: TERMINAL_INPUT.killNextWord, ctrlKey: true, key: "delete" },
  ],
  win32: [],
} as const satisfies Record<AppPlatform, readonly TerminalInputBinding[]>;

const INTERRUPT_CHORD = { key: "c", ctrlKey: true } as const satisfies TerminalKeyChord;
const PASSTHROUGH_ACTION = { type: "passthrough" } as const satisfies TerminalKeyAction;

const matchesKeyChord = (event: TerminalKeyEvent, chord: TerminalKeyChord): boolean =>
  event.key.toLowerCase() === chord.key &&
  event.altKey === Boolean(chord.altKey) &&
  event.ctrlKey === Boolean(chord.ctrlKey) &&
  event.metaKey === Boolean(chord.metaKey) &&
  event.shiftKey === Boolean(chord.shiftKey);

const matchesAnyKeyChord = (
  event: TerminalKeyEvent,
  chords: readonly TerminalKeyChord[],
): boolean => chords.some((chord) => matchesKeyChord(event, chord));

type TerminalKeyEventHandlerInput = {
  getPlatform: () => AppPlatform | undefined;
  hasSelection: () => boolean;
  getSelection: () => string;
  writeClipboard: (text: string) => Promise<void>;
  enqueueInput: (operation: () => Uint8Array | Promise<Uint8Array>) => Promise<void>;
  reportFailure: (cause: unknown) => void;
};

export const encodeTerminalTextInput = (data: string): Uint8Array | null =>
  data.length > 0 ? new TextEncoder().encode(data) : null;

export const resolveTerminalKeyAction = (
  event: TerminalKeyEvent,
  platform: AppPlatform,
  hasSelection: boolean,
): TerminalKeyAction => {
  if (event.type !== "keydown") return PASSTHROUGH_ACTION;
  if (hasSelection && matchesAnyKeyChord(event, COPY_CHORDS_BY_PLATFORM[platform])) {
    return { type: "copy" };
  }
  if (matchesAnyKeyChord(event, PASTE_CHORDS_BY_PLATFORM[platform])) {
    return { type: "paste" };
  }
  if (!hasSelection && matchesKeyChord(event, INTERRUPT_CHORD)) {
    return { bytes: TERMINAL_INPUT.interrupt, type: "input" };
  }
  const inputBinding = LINE_EDITING_BINDINGS_BY_PLATFORM[platform].find((binding) =>
    matchesKeyChord(event, binding),
  );
  if (inputBinding) return { bytes: inputBinding.bytes, type: "input" };
  return PASSTHROUGH_ACTION;
};

export const createTerminalKeyEventHandler = ({
  getPlatform,
  hasSelection,
  getSelection,
  writeClipboard,
  enqueueInput,
  reportFailure,
}: TerminalKeyEventHandlerInput) => {
  return (event: TerminalKeyEvent): boolean => {
    const platform = getPlatform();
    if (!platform) return true;
    const action = resolveTerminalKeyAction(event, platform, hasSelection());
    switch (action.type) {
      case "copy":
        void writeClipboard(getSelection()).catch(reportFailure);
        return false;
      case "paste":
        return true;
      case "input":
        void enqueueInput(() => new Uint8Array(action.bytes));
        return false;
      case "passthrough":
        return true;
    }
  };
};

/** The touch row keys. ShiftTab means Shift+Tab; the other names follow DOM key names. */
export type TerminalTouchKey =
  | "Escape"
  | "Tab"
  | "ShiftTab"
  | "Enter"
  | "Backspace"
  | "Delete"
  | "ArrowUp"
  | "ArrowDown"
  | "ArrowLeft"
  | "ArrowRight";

/** The modifiers that a touch key row holds for the next key. */
export type TerminalKeyModifiers = { readonly ctrl: boolean; readonly alt: boolean };

const ESCAPE = "\u001b";
const ARROW_FINAL = { ArrowUp: "A", ArrowDown: "B", ArrowRight: "C", ArrowLeft: "D" } as const;

/**
 * The bytes of a touch key with its held modifiers. A host shortcut of this policy wins, such as
 * Option+Left on macOS. Other keys, and all keys while the host platform is unknown, use the
 * xterm encoding: arrows follow the cursor key mode of the terminal application, and a modified
 * arrow carries the xterm modifier parameter.
 */
export const encodeTerminalTouchKey = (
  key: TerminalTouchKey,
  modifiers: TerminalKeyModifiers,
  platform: AppPlatform | null,
  applicationCursorKeys: boolean,
): Uint8Array => {
  const action =
    platform === null
      ? PASSTHROUGH_ACTION
      : resolveTerminalKeyAction(
          {
            type: "keydown",
            key,
            altKey: modifiers.alt,
            ctrlKey: modifiers.ctrl,
            metaKey: false,
            shiftKey: false,
          },
          platform,
          false,
        );
  if (action.type === "input") return new Uint8Array(action.bytes);
  const altPrefix = modifiers.alt ? ESCAPE : "";
  if (key === "Escape") return new TextEncoder().encode(`${altPrefix}${ESCAPE}`);
  if (key === "Tab") return new TextEncoder().encode(`${altPrefix}\t`);
  if (key === "ShiftTab") return new TextEncoder().encode(`${ESCAPE}[Z`);
  if (key === "Enter") return new TextEncoder().encode(`${altPrefix}\r`);
  if (key === "Backspace")
    return new TextEncoder().encode(`${altPrefix}${modifiers.ctrl ? "\b" : "\u007f"}`);
  const parameter = 1 + (modifiers.alt ? 2 : 0) + (modifiers.ctrl ? 4 : 0);
  if (key === "Delete")
    return new TextEncoder().encode(`${ESCAPE}[3${parameter > 1 ? `;${parameter}` : ""}~`);
  const final = ARROW_FINAL[key];
  if (parameter > 1) return new TextEncoder().encode(`${ESCAPE}[1;${parameter}${final}`);
  return new TextEncoder().encode(`${ESCAPE}${applicationCursorKeys ? "O" : "["}${final}`);
};

const CTRL_SYMBOLS = new Map([
  [" ", 0],
  ["@", 0],
  ["[", 27],
  ["\\", 28],
  ["]", 29],
  ["^", 30],
  ["_", 31],
  ["?", 127],
]);

const controlCharacter = (character: string): string | null => {
  if (/^[a-z]$/i.test(character)) {
    return String.fromCharCode(character.toLowerCase().charCodeAt(0) & 31);
  }
  const symbol = CTRL_SYMBOLS.get(character);
  return symbol === undefined ? null : String.fromCharCode(symbol);
};

/**
 * Applies held touch modifiers to one typed character, as a hardware Ctrl or Alt chord would:
 * Ctrl+C sends the interrupt byte, and Alt adds the escape prefix. Text with more than one
 * character, such as a pasted word or an autocomplete result, stays as it is.
 */
export const applyTerminalKeyModifiers = (
  data: string,
  modifiers: TerminalKeyModifiers,
): string => {
  if (Array.from(data).length !== 1) return data;
  const controlled = modifiers.ctrl ? (controlCharacter(data) ?? data) : data;
  return modifiers.alt ? `${ESCAPE}${controlled}` : controlled;
};
