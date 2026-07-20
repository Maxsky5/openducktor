const TERMINAL_TITLE_MAX_LENGTH = 160;
const TERMINAL_TITLE_MAX_BYTES = TERMINAL_TITLE_MAX_LENGTH * 4;
const ESCAPE = 0x1b;
const OSC = 0x5d;
const BELL = 0x07;
const STRING_TERMINATOR = 0x5c;
const C1_STRING_TERMINATOR = 0x9c;

type ParserState =
  | "ground"
  | "escape"
  | "osc_code"
  | "osc_separator"
  | "osc_title"
  | "osc_title_escape"
  | "osc_discard"
  | "osc_discard_escape";

const normalizeTerminalTitle = (title: string): string => {
  const sanitizedTitle = Array.from(title.trim())
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint > 31 && (codePoint < 127 || codePoint > 159);
    })
    .slice(0, TERMINAL_TITLE_MAX_LENGTH)
    .join("");
  const shellDirectory = sanitizedTitle.match(/^[^@\s]+@[^:\s]+:(?<directory>[~/].*)$/u)?.groups
    ?.directory;
  return shellDirectory || sanitizedTitle;
};

export type TerminalTitleParser = {
  consume(data: Uint8Array): string | null;
};

export const createTerminalTitleParser = (): TerminalTitleParser => {
  let state: ParserState = "ground";
  let titleBytes: number[] = [];

  const finishTitle = (): string | null => {
    const title = normalizeTerminalTitle(new TextDecoder().decode(new Uint8Array(titleBytes)));
    titleBytes = [];
    state = "ground";
    return title || null;
  };

  const appendTitleByte = (byte: number): void => {
    if (titleBytes.length < TERMINAL_TITLE_MAX_BYTES) titleBytes.push(byte);
  };

  return {
    consume(data) {
      let latestTitle: string | null = null;
      for (const byte of data) {
        if (state === "ground") {
          if (byte === ESCAPE) state = "escape";
          continue;
        }
        if (state === "escape") {
          if (byte === OSC) state = "osc_code";
          else if (byte !== ESCAPE) state = "ground";
          continue;
        }
        if (state === "osc_code") {
          state = byte === 0x30 || byte === 0x32 ? "osc_separator" : "osc_discard";
          continue;
        }
        if (state === "osc_separator") {
          state = byte === 0x3b ? "osc_title" : "osc_discard";
          if (state === "osc_title") titleBytes = [];
          continue;
        }
        if (state === "osc_title") {
          if (byte === BELL || byte === C1_STRING_TERMINATOR) {
            latestTitle = finishTitle() ?? latestTitle;
          } else if (byte === ESCAPE) {
            state = "osc_title_escape";
          } else {
            appendTitleByte(byte);
          }
          continue;
        }
        if (state === "osc_title_escape") {
          if (byte === STRING_TERMINATOR) {
            latestTitle = finishTitle() ?? latestTitle;
          } else {
            appendTitleByte(ESCAPE);
            appendTitleByte(byte);
            state = "osc_title";
          }
          continue;
        }
        if (state === "osc_discard") {
          if (byte === BELL || byte === C1_STRING_TERMINATOR) state = "ground";
          else if (byte === ESCAPE) state = "osc_discard_escape";
          continue;
        }
        if (byte === STRING_TERMINATOR) state = "ground";
        else if (byte !== ESCAPE) state = "osc_discard";
      }
      return latestTitle;
    },
  };
};
