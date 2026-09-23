import type { Terminal } from "@xterm/headless";

const ESC = 0x1b;
const MAX_PENDING_BYTES = 64 * 1024;

type ParserState =
  | "ground"
  | "escape"
  | "escape_intermediate"
  | "csi"
  | "osc"
  | "osc_escape"
  | "string"
  | "string_escape"
  | "utf8";

type XtermAttributes = {
  isAttributeDefault(): boolean;
  isFgRGB(): boolean;
  isFgPalette(): boolean;
  isBgRGB(): boolean;
  isBgPalette(): boolean;
  getFgColor(): number;
  getBgColor(): number;
  isBold(): number | boolean;
  isDim(): number | boolean;
  isItalic(): number | boolean;
  isUnderline(): number | boolean;
  isBlink(): number | boolean;
  isInverse(): number | boolean;
  isInvisible(): number | boolean;
  isStrikethrough(): number | boolean;
  isOverline(): number | boolean;
};

type XtermCore = {
  buffer: {
    savedX: number;
    savedY: number;
    ybase: number;
    scrollTop: number;
    scrollBottom: number;
    tabs: Record<string, boolean>;
    savedCurAttrData: XtermAttributes;
  };
  _inputHandler: { _curAttrData: XtermAttributes };
  coreService: { isCursorHidden: boolean };
};

const getCore = (terminal: Terminal): XtermCore => {
  // SAFETY: xterm 6.0.0 has these internal fields. Screen restore tests pin their behavior.
  const core = (terminal as Terminal & { _core?: XtermCore })._core;
  if (
    !core ||
    !Number.isInteger(core.buffer?.savedX) ||
    !Number.isInteger(core.buffer?.savedY) ||
    !Number.isInteger(core.buffer?.scrollTop) ||
    !Number.isInteger(core.buffer?.scrollBottom) ||
    !core.buffer?.tabs ||
    !core.buffer.savedCurAttrData?.getFgColor ||
    !core._inputHandler?._curAttrData?.getFgColor ||
    core.coreService?.isCursorHidden === undefined
  ) {
    throw new Error("Terminal screen state is unavailable. Restart OpenDucktor and try again.");
  }
  return core;
};

const colorCodes = (attributes: XtermAttributes, foreground: boolean): number[] => {
  const color = foreground ? attributes.getFgColor() : attributes.getBgColor();
  const rgb = foreground ? attributes.isFgRGB() : attributes.isBgRGB();
  const palette = foreground ? attributes.isFgPalette() : attributes.isBgPalette();
  if (rgb) {
    return [foreground ? 38 : 48, 2, (color >>> 16) & 255, (color >>> 8) & 255, color & 255];
  }
  if (palette) {
    if (color >= 16) return [foreground ? 38 : 48, 5, color];
    const base = foreground ? (color & 8 ? 90 : 30) : color & 8 ? 100 : 40;
    return [base + (color & 7)];
  }
  return [];
};

const styleSequence = (attributes: XtermAttributes): string => {
  if (attributes.isAttributeDefault()) return "";
  const codes = [
    ...colorCodes(attributes, true),
    ...colorCodes(attributes, false),
    ...(attributes.isBold() ? [1] : []),
    ...(attributes.isDim() ? [2] : []),
    ...(attributes.isItalic() ? [3] : []),
    ...(attributes.isUnderline() ? [4] : []),
    ...(attributes.isBlink() ? [5] : []),
    ...(attributes.isInverse() ? [7] : []),
    ...(attributes.isInvisible() ? [8] : []),
    ...(attributes.isStrikethrough() ? [9] : []),
    ...(attributes.isOverline() ? [53] : []),
  ];
  return codes.length > 0 ? `\u001b[${codes.join(";")}m` : "";
};

export class TerminalScreenTail {
  private state: ParserState = "ground";
  private pending: number[] = [];
  private utf8Remaining = 0;
  private cursorStyle = "";
  private stringIntro: number | null = null;
  private discardedStringPayload = false;

  accept(data: Uint8Array): void {
    for (const byte of data) this.acceptByte(byte);
  }

  suffix(terminal: Terminal): Uint8Array {
    if (this.pending.length > MAX_PENDING_BYTES) {
      throw new Error(
        "Terminal control sequence is too long to restore. Close this tab and create a new terminal.",
      );
    }
    const core = getCore(terminal);
    const buffer = core.buffer;
    const tabs = Object.keys(buffer.tabs)
      .filter((key) => buffer.tabs[key])
      .map(Number)
      .filter((column) => Number.isInteger(column) && column >= 0 && column < terminal.cols)
      .sort((left, right) => left - right);
    const defaultTabs = [
      0,
      ...Array.from({ length: Math.floor((terminal.cols - 1) / 8) }, (_, index) => (index + 1) * 8),
    ];
    const customTabs =
      tabs.length !== defaultTabs.length ||
      tabs.some((column, index) => column !== defaultTabs[index]);
    const savedX = Math.max(0, Math.min(buffer.savedX, terminal.cols - 1));
    const savedY = Math.max(0, Math.min(buffer.savedY - buffer.ybase, terminal.rows - 1));
    const savedStyle = styleSequence(buffer.savedCurAttrData);
    const hasSavedCursor = savedX !== 0 || savedY !== 0 || savedStyle !== "";
    const hasScrollRegion = buffer.scrollTop !== 0 || buffer.scrollBottom !== terminal.rows - 1;
    const needsCursorMove = customTabs || hasSavedCursor || hasScrollRegion;
    const originMode = terminal.modes.originMode;
    const parts: string[] = [];

    if (needsCursorMove) parts.push("\u001b[?6l");
    if (customTabs) {
      parts.push("\u001b[3g");
      for (const column of tabs) parts.push(`\u001b[1;${column + 1}H\u001bH`);
    }
    if (hasSavedCursor) {
      parts.push(`\u001b[${savedY + 1};${savedX + 1}H\u001b[0m${savedStyle}\u001b7`);
      parts.push(`\u001b[0m${styleSequence(core._inputHandler._curAttrData)}`);
    }
    if (hasScrollRegion) {
      parts.push(`\u001b[${buffer.scrollTop + 1};${buffer.scrollBottom + 1}r`);
    }
    if (needsCursorMove) {
      if (originMode) parts.push("\u001b[?6h");
      const row = terminal.buffer.active.cursorY - (originMode ? buffer.scrollTop : 0) + 1;
      const cursorX = terminal.buffer.active.cursorX;
      if (cursorX < terminal.cols) {
        parts.push(`\u001b[${row};${cursorX + 1}H`);
      } else {
        // CUP clamps at the right edge. Reprint the existing last cell to restore pending wrap.
        const line = terminal.buffer.active.getLine(terminal.buffer.active.cursorY);
        const last = line?.getCell(terminal.cols - 1);
        const start = last?.getWidth() === 0 ? terminal.cols - 2 : terminal.cols - 1;
        const cell = line?.getCell(start);
        if (!cell || start < 0) {
          throw new Error(
            "Terminal cursor state is unavailable. Resize the terminal and reconnect.",
          );
        }
        parts.push(
          `\u001b[${row};${start + 1}H\u001b[0m${styleSequence(cell)}${cell.getChars() || " "}\u001b[0m${styleSequence(core._inputHandler._curAttrData)}`,
        );
      }
    }
    if (core.coreService.isCursorHidden) parts.push("\u001b[?25l");
    if (this.cursorStyle) parts.push(this.cursorStyle);
    const ignoredString = this.discardedStringPayload
      ? this.stringIntro === 0x5d
        ? "\u001b]999999;"
        : this.stringIntro === 0x50
          ? "\u001bPz"
          : `\u001b${String.fromCharCode(this.stringIntro ?? 0x5f)}`
      : "";
    const pending = this.discardedStringPayload
      ? new TextEncoder().encode(ignoredString + (this.state.endsWith("_escape") ? "\u001b" : ""))
      : new Uint8Array(this.pending);
    const modes = new TextEncoder().encode(parts.join(""));
    const suffix = new Uint8Array(modes.byteLength + pending.byteLength);
    suffix.set(modes);
    suffix.set(pending, modes.byteLength);
    return suffix;
  }

  private acceptByte(byte: number): void {
    if (this.state === "ground") {
      if (byte === ESC) {
        this.start(byte, "escape");
      } else if (byte >= 0xc2 && byte <= 0xf4) {
        this.start(byte, "utf8");
        this.utf8Remaining = byte < 0xe0 ? 1 : byte < 0xf0 ? 2 : 3;
      }
      return;
    }
    if (this.state === "utf8") {
      if (byte >= 0x80 && byte <= 0xbf) {
        this.push(byte);
        this.utf8Remaining -= 1;
        if (this.utf8Remaining === 0) this.finish();
      } else {
        this.finish();
        this.acceptByte(byte);
      }
      return;
    }
    if (this.state === "escape") {
      this.push(byte);
      if (byte === 0x5b) this.state = "csi";
      else if (byte === 0x5d) {
        this.stringIntro = byte;
        this.state = "osc";
      } else if ([0x50, 0x5e, 0x5f, 0x58].includes(byte)) {
        this.stringIntro = byte;
        this.state = "string";
      } else if (byte >= 0x20 && byte <= 0x2f) this.state = "escape_intermediate";
      else {
        if (byte === 0x63) this.cursorStyle = "";
        this.finish();
      }
      return;
    }
    if (this.state === "escape_intermediate") {
      this.push(byte);
      if (byte >= 0x30 && byte <= 0x7e) this.finish();
      return;
    }
    if (this.state === "csi") {
      if (byte === ESC) {
        this.start(byte, "escape");
        return;
      }
      if (byte === 0x18 || byte === 0x1a) {
        this.finish();
        return;
      }
      this.push(byte);
      if (byte >= 0x40 && byte <= 0x7e) {
        const sequence = new TextDecoder().decode(new Uint8Array(this.pending));
        if (sequence.startsWith("\u001b[") && /^\d* q$/.test(sequence.slice(2))) {
          this.cursorStyle = sequence;
        }
        this.finish();
      }
      return;
    }
    if (this.state === "osc" || this.state === "string") {
      if (this.state === "osc" && byte === 0x07) {
        this.finish();
      } else {
        this.push(byte);
        if (byte === ESC) this.state = this.state === "osc" ? "osc_escape" : "string_escape";
      }
      return;
    }
    this.push(byte);
    if (byte === 0x5c) this.finish();
    else if (byte !== ESC) this.state = this.state === "osc_escape" ? "osc" : "string";
  }

  private start(byte: number, state: ParserState): void {
    this.pending = [byte];
    this.state = state;
    this.stringIntro = null;
    this.discardedStringPayload = false;
  }

  private push(byte: number): void {
    if (this.discardedStringPayload) return;
    if (this.pending.length < MAX_PENDING_BYTES) {
      this.pending.push(byte);
      return;
    }
    if (["osc", "osc_escape", "string", "string_escape"].includes(this.state)) {
      this.pending = [];
      this.discardedStringPayload = true;
      return;
    }
    this.pending.push(byte);
  }

  private finish(): void {
    this.pending = [];
    this.state = "ground";
    this.stringIntro = null;
    this.discardedStringPayload = false;
  }
}
