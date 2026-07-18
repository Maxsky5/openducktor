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

type TerminalKeyEvent = Pick<
  KeyboardEvent,
  "altKey" | "ctrlKey" | "key" | "metaKey" | "shiftKey" | "type"
>;

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
  return (event: KeyboardEvent): boolean => {
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
