import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/headless";
import { TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES } from "@openducktor/contracts";
import type { TerminalGrid } from "../../ports/terminal-pty-port";
import { attributeOverlay } from "./terminal-screen-style";
import { TerminalScreenTail } from "./terminal-screen-tail";

type ScreenOperation =
  | { type: "write"; data: Uint8Array; parsed: () => void }
  | { type: "resize"; grid: TerminalGrid };

type XtermColorRequest =
  | { type: 0; index: number }
  | { type: 1; index: number; color: readonly [number, number, number] }
  | { type: 2; index?: number };

const COLOR_RESET = "\u001b]104\u001b\\\u001b]110\u001b\\\u001b]111\u001b\\\u001b]112\u001b\\";
const SCREEN_SCROLLBACK_ROWS = 2000;

export type TerminalScreenSnapshot = {
  columns: number;
  rows: number;
  payload: Uint8Array;
  precedingJoinState: number;
};

export class TerminalScreenBusyError extends Error {}

export class TerminalScreenState {
  private readonly terminal: Terminal;
  private readonly serializer = new SerializeAddon();
  private readonly tail = new TerminalScreenTail();
  private readonly operations: ScreenOperation[] = [];
  private nextOperation = 0;
  private readonly drainWaiters: Array<() => void> = [];
  private readonly colors = new Map<number, string>();
  private writing = false;
  private pendingBytes = 0;

  constructor(grid: TerminalGrid) {
    this.terminal = new Terminal({
      cols: grid.columns,
      rows: grid.rows,
      scrollback: SCREEN_SCROLLBACK_ROWS,
      allowProposedApi: true,
    });
    this.terminal.loadAddon(this.serializer);
    // SAFETY: xterm 6.0.0 emits parsed OSC color changes from this internal handler.
    const inputHandler = (
      this.terminal as Terminal & {
        _core?: {
          _inputHandler?: {
            onColor?: (listener: (requests: XtermColorRequest[]) => void) => void;
          };
        };
      }
    )._core?._inputHandler;
    if (!inputHandler?.onColor) {
      throw new Error("Terminal color state is unavailable. Restart OpenDucktor and try again.");
    }
    inputHandler.onColor((requests) => this.trackColors(requests));
  }

  get queuedBytes(): number {
    return this.pendingBytes;
  }

  write(data: Uint8Array, parsed: () => void): void {
    if (data.byteLength === 0) return;
    const copy = data.slice();
    this.tail.accept(copy);
    this.pendingBytes += copy.byteLength;
    this.operations.push({ type: "write", data: copy, parsed });
    this.advance();
  }

  resize(grid: TerminalGrid): void {
    this.operations.push({ type: "resize", grid });
    this.advance();
  }

  drained(): Promise<void> {
    if (!this.writing && this.nextOperation === this.operations.length) return Promise.resolve();
    return new Promise((resolve) => this.drainWaiters.push(resolve));
  }

  snapshot(): TerminalScreenSnapshot {
    if (this.writing || this.nextOperation < this.operations.length)
      throw new TerminalScreenBusyError();
    const normalPrelude = this.tail.normalPrelude(this.terminal);
    const normalOverlay = attributeOverlay(this.terminal, this.terminal.buffer.normal);
    const alternateOverlay =
      this.terminal.buffer.active.type === "alternate"
        ? attributeOverlay(this.terminal, this.terminal.buffer.alternate)
        : "";
    const { payload: suffix, precedingJoinState } = this.tail.suffix(
      this.terminal,
      !!normalOverlay || !!alternateOverlay,
    );
    const colorPrelude = this.colorPrelude();
    const serialize = (scrollback: number): Uint8Array => {
      const screen = this.serializer.serialize({ scrollback }) || "\u001b[0m";
      const alternateStart = "\u001b[?1049h";
      const alternateIndex = normalPrelude ? screen.indexOf(alternateStart) : -1;
      if (normalPrelude && alternateIndex < 0)
        throw new Error(
          "Terminal alternate screen state is unavailable. Resize the terminal and reconnect.",
        );
      const screenContent =
        alternateIndex < 0
          ? screen + normalOverlay
          : screen.slice(0, alternateIndex) +
            normalOverlay +
            normalPrelude +
            screen.slice(alternateIndex) +
            alternateOverlay;
      const serialized = new TextEncoder().encode(colorPrelude + screenContent);
      const payload = new Uint8Array(serialized.byteLength + suffix.byteLength);
      payload.set(serialized);
      payload.set(suffix, serialized.byteLength);
      return payload;
    };
    const maxPayloadBytes = TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES - 1024;
    let payload = serialize(SCREEN_SCROLLBACK_ROWS);
    if (payload.byteLength > maxPayloadBytes) {
      const visiblePayload = serialize(0);
      if (visiblePayload.byteLength <= maxPayloadBytes) {
        const availableRows = Math.min(
          SCREEN_SCROLLBACK_ROWS,
          Math.max(0, this.terminal.buffer.normal.length - this.terminal.rows),
        );
        let fittingRows = 0;
        let fittingPayload = visiblePayload;
        let oversizedRows = availableRows;
        let oversizedBytes = payload.byteLength;
        let requestedRows = Math.max(
          1,
          Math.floor(
            (availableRows * (maxPayloadBytes - visiblePayload.byteLength)) /
              (payload.byteLength - visiblePayload.byteLength),
          ),
        );
        while (requestedRows > 0 && requestedRows < oversizedRows) {
          const candidate = serialize(requestedRows);
          if (candidate.byteLength <= maxPayloadBytes) {
            fittingRows = requestedRows;
            fittingPayload = candidate;
            break;
          }
          oversizedRows = requestedRows;
          oversizedBytes = candidate.byteLength;
          // Shrink each failed probe so large rows cannot cause repeated full-buffer scans.
          requestedRows = Math.floor(requestedRows / 2);
        }
        if (fittingRows > 0 && oversizedRows - fittingRows > 1) {
          const additionalRows = Math.floor(
            ((oversizedRows - fittingRows) * (maxPayloadBytes - fittingPayload.byteLength)) /
              (oversizedBytes - fittingPayload.byteLength),
          );
          const nextRows = Math.min(
            oversizedRows - 1,
            Math.max(fittingRows + 1, fittingRows + additionalRows),
          );
          const candidate = serialize(nextRows);
          if (candidate.byteLength <= maxPayloadBytes) {
            fittingRows = nextRows;
            fittingPayload = candidate;
          } else {
            oversizedRows = nextRows;
          }
          while (oversizedRows - fittingRows > 1) {
            const middleRows = Math.floor((fittingRows + oversizedRows) / 2);
            const middle = serialize(middleRows);
            if (middle.byteLength <= maxPayloadBytes) {
              fittingRows = middleRows;
              fittingPayload = middle;
            } else {
              oversizedRows = middleRows;
            }
          }
        }
        payload = fittingPayload;
      }
    }
    if (payload.byteLength > maxPayloadBytes) {
      throw new Error(
        "Terminal screen is too large to restore. Resize the terminal and reconnect.",
      );
    }
    return { columns: this.terminal.cols, rows: this.terminal.rows, payload, precedingJoinState };
  }

  dispose(): void {
    this.terminal.dispose();
  }

  private trackColors(requests: XtermColorRequest[]): void {
    for (const request of requests) {
      if (request.type === 1) {
        this.colors.set(
          request.index,
          `#${request.color.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`,
        );
      } else if (request.type === 2) {
        if (request.index === undefined) {
          for (const index of this.colors.keys()) if (index < 256) this.colors.delete(index);
        } else {
          this.colors.delete(request.index);
        }
      }
    }
  }

  private colorPrelude(): string {
    const parts = [COLOR_RESET];
    for (const [index, color] of [...this.colors].sort(([left], [right]) => left - right)) {
      const command = index < 256 ? `4;${index}` : String(index - 246);
      parts.push(`\u001b]${command};${color}\u001b\\`);
    }
    return parts.join("");
  }

  private advance(): void {
    if (this.writing) return;
    while (this.nextOperation < this.operations.length) {
      const operation = this.operations[this.nextOperation++];
      if (!operation) break;
      if (this.nextOperation > 1024 && this.nextOperation * 2 >= this.operations.length) {
        this.operations.splice(0, this.nextOperation);
        this.nextOperation = 0;
      }
      if (operation.type === "resize") {
        this.terminal.resize(operation.grid.columns, operation.grid.rows);
        continue;
      }
      this.writing = true;
      this.terminal.write(operation.data, () => {
        this.writing = false;
        this.pendingBytes -= operation.data.byteLength;
        operation.parsed();
        this.advance();
      });
      return;
    }
    this.operations.length = 0;
    this.nextOperation = 0;
    for (const resolve of this.drainWaiters.splice(0)) resolve();
  }
}
