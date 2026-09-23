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

export type ScreenControlMarker =
  | { end: number; kind: "save"; style: string }
  | { end: number; kind: "set_tab" | "clear_tab" | "clear_all_tabs" };

type SavedCursor = { x: number; y: number; style: string };
type SavedCursors = { normal: SavedCursor | null; alternate: SavedCursor | null };

export class TerminalScreenTail {
  private state: ParserState = "ground";
  private pending: number[] = [];
  private utf8Remaining = 0;
  private cursorVisible = true;
  private cursorStyle = "";
  private marker: ScreenControlMarker["kind"] | null = null;
  private sgrProgram = "";
  private tabStops: Set<number> | null = null;
  private readonly savedCursors: SavedCursors = {
    normal: null,
    alternate: null,
  };
  private readonly savedStyles = { normal: "", alternate: "" };
  private activeBuffer: "normal" | "alternate" = "normal";
  private readonly scrollRegions = {
    normal: { sequence: "", top: 1 },
    alternate: { sequence: "", top: 1 },
  };

  accept(data: Uint8Array): ScreenControlMarker[] {
    const markers: ScreenControlMarker[] = [];
    for (let index = 0; index < data.length; index += 1) {
      this.acceptByte(data[index] ?? 0);
      if (this.marker) {
        if (this.marker === "save") {
          this.savedStyles[this.activeBuffer] = this.sgrProgram;
          markers.push({ end: index + 1, kind: "save", style: this.sgrProgram });
        } else {
          markers.push({ end: index + 1, kind: this.marker });
        }
        this.marker = null;
      }
    }
    return markers;
  }

  updateTabs(
    kind: "set_tab" | "clear_tab" | "clear_all_tabs",
    column: number,
    columns: number,
  ): void {
    if (kind === "clear_all_tabs") {
      this.tabStops = new Set();
      return;
    }
    if (!this.tabStops) {
      this.tabStops = new Set<number>();
      for (let stop = 8; stop < columns; stop += 8) this.tabStops.add(stop);
    }
    if (kind === "set_tab") this.tabStops.add(column);
    else this.tabStops.delete(column);
  }

  saveCursor(buffer: "normal" | "alternate", x: number, y: number, style: string): void {
    this.savedCursors[buffer] = { x, y, style };
  }

  resize(): void {
    this.scrollRegions[this.activeBuffer] = { sequence: "", top: 1 };
  }

  suffix(cursorX: number, cursorY: number, originMode: boolean): Uint8Array {
    if (this.pending.length > MAX_PENDING_BYTES) {
      throw new Error(
        "Terminal control sequence is too long to restore. Close this tab and create a new terminal.",
      );
    }
    if (
      this.sgrProgram.length > MAX_PENDING_BYTES ||
      (this.savedCursors[this.activeBuffer]?.style.length ?? 0) > MAX_PENDING_BYTES
    ) {
      throw new Error(
        "Terminal style state is too large to restore. Close this tab and create a new terminal.",
      );
    }
    const scrollRegion = this.scrollRegions[this.activeBuffer];
    const tabs = this.tabStops
      ? `\u001b[?6l\u001b[3g${[...this.tabStops]
          .sort((left, right) => left - right)
          .map((column) => `\u001b[1;${column + 1}H\u001bH`)
          .join("")}`
      : "";
    const savedCursor = this.savedCursors[this.activeBuffer];
    const savedPosition = savedCursor
      ? `\u001b[0m${savedCursor.style}\u001b[?6l\u001b[${savedCursor.y + 1};${savedCursor.x + 1}H\u001b7\u001b[0m${this.sgrProgram}`
      : "";
    const region = scrollRegion.sequence
      ? `${originMode ? "\u001b[?6l" : ""}${scrollRegion.sequence}${originMode ? "\u001b[?6h" : ""}\u001b[${originMode ? cursorY - scrollRegion.top + 2 : cursorY + 1};${cursorX + 1}H`
      : "";
    const currentPosition =
      (savedCursor || tabs) && !region
        ? `${originMode ? "\u001b[?6h" : ""}\u001b[${originMode ? cursorY - scrollRegion.top + 2 : cursorY + 1};${cursorX + 1}H`
        : "";
    const modes = `${tabs}${savedPosition}${region}${currentPosition}${this.cursorVisible ? "" : "\u001b[?25l"}${this.cursorStyle}`;
    const modeBytes = new TextEncoder().encode(modes);
    const suffix = new Uint8Array(modeBytes.byteLength + this.pending.length);
    suffix.set(modeBytes);
    suffix.set(this.pending, modeBytes.byteLength);
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
      else if (byte === 0x5d) this.state = "osc";
      else if (byte === 0x50 || byte === 0x5e || byte === 0x5f || byte === 0x58)
        this.state = "string";
      else if (byte >= 0x20 && byte <= 0x2f) this.state = "escape_intermediate";
      else {
        if (byte === 0x37) this.marker = "save";
        if (byte === 0x38) this.sgrProgram = this.savedStyles[this.activeBuffer];
        if (byte === 0x48) this.marker = "set_tab";
        if (byte === 0x63) this.resetModes();
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
        this.trackCursorMode();
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
    else this.state = this.state === "osc_escape" ? "osc" : "string";
  }

  private trackCursorMode(): void {
    const sequence = new TextDecoder().decode(new Uint8Array(this.pending));
    const body = sequence.startsWith("\u001b[") ? sequence.slice(2) : "";
    const visibility = /^\?([\d;]*)([hl])$/.exec(body);
    if (visibility?.[1]?.split(";").includes("25")) this.cursorVisible = visibility[2] === "h";
    if (visibility?.[1]?.split(";").some((mode) => ["47", "1047", "1049"].includes(mode))) {
      this.activeBuffer = visibility[2] === "h" ? "alternate" : "normal";
      if (this.activeBuffer === "alternate") {
        this.scrollRegions.alternate = { sequence: "", top: 1 };
        this.savedCursors.alternate = null;
        this.savedStyles.alternate = "";
      }
    }
    if (/^\d* q$/.test(body)) this.cursorStyle = sequence;
    if (/^[\d;:]*m$/.test(body)) {
      if (body === "m" || body.startsWith("0;")) this.sgrProgram = "";
      if (this.sgrProgram.length <= MAX_PENDING_BYTES) this.sgrProgram += sequence;
    }
    if (body === "s") this.marker = "save";
    if (body === "u") this.sgrProgram = this.savedStyles[this.activeBuffer];
    if (body === "g" || body === "0g") this.marker = "clear_tab";
    if (body === "3g") this.marker = "clear_all_tabs";
    const scrollRegion = /^(\d*)(?:;(\d*))?r$/.exec(body);
    if (scrollRegion) {
      this.scrollRegions[this.activeBuffer] = {
        sequence,
        top: Number(scrollRegion[1] || 1),
      };
    }
  }

  private resetModes(): void {
    this.cursorVisible = true;
    this.cursorStyle = "";
    this.sgrProgram = "";
    this.tabStops = null;
    this.activeBuffer = "normal";
    this.scrollRegions.normal = { sequence: "", top: 1 };
    this.scrollRegions.alternate = { sequence: "", top: 1 };
    this.savedCursors.normal = null;
    this.savedCursors.alternate = null;
    this.savedStyles.normal = "";
    this.savedStyles.alternate = "";
  }

  private start(byte: number, state: ParserState): void {
    this.pending = [byte];
    this.state = state;
  }

  private push(byte: number): void {
    if (this.pending.length <= MAX_PENDING_BYTES) this.pending.push(byte);
  }

  private finish(): void {
    this.pending = [];
    this.state = "ground";
  }
}
