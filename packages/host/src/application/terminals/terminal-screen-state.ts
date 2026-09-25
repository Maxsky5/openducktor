import { SerializeAddon } from "@xterm/addon-serialize";
import { Terminal } from "@xterm/headless";
import { TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES } from "@openducktor/contracts";
import type { TerminalGrid } from "../../ports/terminal-pty-port";
import { attributeOverlay } from "./terminal-screen-style";
import { TerminalScreenTail } from "./terminal-screen-tail";

type ScreenOperation =
  | { type: "write"; data: Uint8Array; parsed: () => void }
  | { type: "resize"; grid: TerminalGrid };

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
  private writing = false;
  private pendingBytes = 0;

  constructor(grid: TerminalGrid) {
    this.terminal = new Terminal({
      cols: grid.columns,
      rows: grid.rows,
      scrollback: 0,
      allowProposedApi: true,
    });
    this.terminal.loadAddon(this.serializer);
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
    const screen = this.serializer.serialize({ scrollback: 0 }) || "\u001b[0m";
    const normalPrelude = this.tail.normalPrelude(this.terminal);
    const normalOverlay = attributeOverlay(this.terminal, this.terminal.buffer.normal);
    const alternateOverlay =
      this.terminal.buffer.active.type === "alternate"
        ? attributeOverlay(this.terminal, this.terminal.buffer.alternate)
        : "";
    const alternateStart = "\u001b[?1049h";
    const alternateIndex = normalPrelude ? screen.indexOf(alternateStart) : -1;
    if (normalPrelude && alternateIndex < 0)
      throw new Error(
        "Terminal alternate screen state is unavailable. Resize the terminal and reconnect.",
      );
    const serialized = new TextEncoder().encode(
      alternateIndex < 0
        ? screen + normalOverlay
        : screen.slice(0, alternateIndex) +
            normalOverlay +
            normalPrelude +
            screen.slice(alternateIndex) +
            alternateOverlay,
    );
    const { payload: suffix, precedingJoinState } = this.tail.suffix(
      this.terminal,
      !!normalOverlay || !!alternateOverlay,
    );
    const payload = new Uint8Array(serialized.byteLength + suffix.byteLength);
    payload.set(serialized);
    payload.set(suffix, serialized.byteLength);
    if (payload.byteLength > TERMINAL_PROTOCOL_MAX_MESSAGE_BYTES - 1024) {
      throw new Error(
        "Terminal screen is too large to restore. Resize the terminal and reconnect.",
      );
    }
    return { columns: this.terminal.cols, rows: this.terminal.rows, payload, precedingJoinState };
  }

  dispose(): void {
    this.terminal.dispose();
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
