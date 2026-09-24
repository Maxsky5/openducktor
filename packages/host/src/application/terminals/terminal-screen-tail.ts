import type { Terminal } from "@xterm/headless";

const ESC = 0x1b;
const MAX_PENDING_BYTES = 64 * 1024;
const SEQUENCE_DECODER = new TextDecoder();
const CHARSET_FLAGS = new Set("0AB4C5RQKYE6ZH7=");
const CHARSET_PREFIXES = ["(", ")", "*", "+"] as const;
const CHARSET_LEVEL_BY_PREFIX = {
  "(": 0,
  ")": 1,
  "*": 2,
  "+": 3,
  "-": 1,
  ".": 2,
} as const;

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

type XtermSavedBuffer = {
  savedX: number;
  savedY: number;
  ybase: number;
  savedCurAttrData: XtermAttributes;
};

type XtermCore = {
  buffer: XtermSavedBuffer & {
    scrollTop: number;
    scrollBottom: number;
    tabs: Record<string, boolean>;
  };
  _bufferService: { buffers: { normal: XtermSavedBuffer } };
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
    !Number.isInteger(core._bufferService?.buffers?.normal?.savedX) ||
    !Number.isInteger(core._bufferService?.buffers?.normal?.savedY) ||
    !core._bufferService?.buffers?.normal?.savedCurAttrData?.getFgColor ||
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
  private discardedControlSequence = false;
  private readonly charsets = ["B", "B", "B", "B"];
  private charsetLevel = 0;
  private activeCharset = "B";
  private readonly savedCharsets = { normal: "B", alternate: "B" };
  private activeBuffer: "normal" | "alternate" = "normal";

  private get savedCharset(): string {
    return this.savedCharsets[this.activeBuffer];
  }

  private set savedCharset(value: string) {
    this.savedCharsets[this.activeBuffer] = value;
  }

  accept(data: Uint8Array): void {
    for (const byte of data) this.acceptByte(byte);
  }

  normalPrelude(terminal: Terminal): string {
    if (terminal.buffer.active.type !== "alternate") return "";
    const normal = getCore(terminal)._bufferService.buffers.normal;
    const x = Math.max(0, Math.min(normal.savedX, terminal.cols - 1));
    const y = Math.max(0, Math.min(normal.savedY - normal.ybase, terminal.rows - 1));
    return `\u001b(${this.savedCharsets.normal}\u000f\u001b[${y + 1};${x + 1}H\u001b[0m${styleSequence(normal.savedCurAttrData)}`;
  }

  suffix(terminal: Terminal): Uint8Array {
    if (this.discardedControlSequence) {
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
    const hasSavedCursor =
      savedX !== 0 ||
      savedY !== 0 ||
      savedStyle !== "" ||
      this.savedCharset !== "B" ||
      this.activeCharset !== this.charsets[this.charsetLevel];
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
      parts.push(`\u001b(${this.savedCharset}\u000f`);
      parts.push(`\u001b[${savedY + 1};${savedX + 1}H\u001b[0m${savedStyle}\u001b7`);
    }
    for (let level = 0; level < CHARSET_PREFIXES.length; level += 1) {
      const flag = this.charsets[level];
      if (flag !== "B" || (hasSavedCursor && level === 0))
        parts.push(`\u001b${CHARSET_PREFIXES[level]}${flag}`);
    }
    if (this.charsetLevel === 0) parts.push("\u000f");
    else if (this.charsetLevel === 1) parts.push("\u000e");
    else parts.push(this.charsetLevel === 2 ? "\u001bn" : "\u001bo");
    if (this.activeCharset !== this.charsets[this.charsetLevel]) {
      if (this.activeCharset !== this.savedCharset)
        throw new Error(
          "Terminal character set state is unavailable. Close this tab and create a new terminal.",
        );
      parts.push("\u001b8");
    }
    if (hasSavedCursor) parts.push(`\u001b[0m${styleSequence(core._inputHandler._curAttrData)}`);
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
      } else if (byte === 0x0e || byte === 0x0f) {
        this.charsetLevel = byte === 0x0e ? 1 : 0;
        this.activeCharset = this.charsets[this.charsetLevel] ?? "B";
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
        const sequence = SEQUENCE_DECODER.decode(new Uint8Array(this.pending));
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
    this.discardedControlSequence = false;
  }

  private push(byte: number): void {
    if (this.discardedStringPayload || this.discardedControlSequence) return;
    if (this.pending.length < MAX_PENDING_BYTES) {
      this.pending.push(byte);
      return;
    }
    if (["osc", "osc_escape", "string", "string_escape"].includes(this.state)) {
      this.pending = [];
      this.discardedStringPayload = true;
      return;
    }
    this.pending = [];
    this.discardedControlSequence = true;
  }

  private finish(): void {
    this.updateCharset();
    this.pending = [];
    this.state = "ground";
    this.stringIntro = null;
    this.discardedStringPayload = false;
    this.discardedControlSequence = false;
  }

  private updateCharset(): void {
    if (this.pending[0] !== ESC) return;
    if (this.pending[1] !== 0x5b && this.pending.length > 3) return;
    const sequence = SEQUENCE_DECODER.decode(new Uint8Array(this.pending));
    if (sequence.length === 3 && CHARSET_FLAGS.has(sequence[2] ?? "")) {
      // SAFETY: An unknown prefix returns undefined, which the next guard rejects.
      const level = CHARSET_LEVEL_BY_PREFIX[sequence[1] as keyof typeof CHARSET_LEVEL_BY_PREFIX];
      if (level !== undefined) {
        this.charsets[level] = sequence[2] ?? "B";
        if (this.charsetLevel === level) this.activeCharset = this.charsets[level] ?? "B";
        return;
      }
    }
    if (sequence === "\u001b7" || sequence === "\u001b[s") {
      this.savedCharset = this.activeCharset;
    } else if (sequence === "\u001b8" || sequence === "\u001b[u") {
      this.activeCharset = this.savedCharset;
    } else if (sequence === "\u001bc" || sequence === "\u001b[!p") {
      this.charsets.fill("B");
      this.charsetLevel = 0;
      this.activeCharset = "B";
      if (sequence === "\u001bc") {
        this.savedCharsets.normal = "B";
        this.savedCharsets.alternate = "B";
        this.activeBuffer = "normal";
      } else this.savedCharset = "B";
    } else if (sequence === "\u001b%@" || sequence === "\u001b%G") {
      this.charsets[0] = "B";
      this.charsetLevel = 0;
      this.activeCharset = "B";
    } else if (["\u001bn", "\u001bo", "\u001b|", "\u001b}", "\u001b~"].includes(sequence)) {
      this.charsetLevel =
        sequence === "\u001bn" || sequence === "\u001b}" ? 2 : sequence === "\u001b~" ? 1 : 3;
      this.activeCharset = this.charsets[this.charsetLevel] ?? "B";
    } else {
      if (!sequence.startsWith("\u001b[?")) return;
      const mode = /^([\d;]+)([hl])$/.exec(sequence.slice(3));
      if (!mode) return;
      const values = mode[1]?.split(";") ?? [];
      for (const value of values) {
        if (value === "2" && mode[2] === "h") {
          this.charsets.fill("B");
          this.activeCharset = "B";
        } else if (value === "1048") {
          if (mode[2] === "h") this.savedCharset = this.activeCharset;
          else this.activeCharset = this.savedCharset;
        } else if (value === "1049") {
          if (mode[2] === "h") {
            this.savedCharset = this.activeCharset;
            this.activeBuffer = "alternate";
          } else {
            this.activeBuffer = "normal";
            this.activeCharset = this.savedCharset;
          }
        } else if (value === "47" || value === "1047") {
          this.activeBuffer = mode[2] === "h" ? "alternate" : "normal";
        }
      }
    }
  }
}
