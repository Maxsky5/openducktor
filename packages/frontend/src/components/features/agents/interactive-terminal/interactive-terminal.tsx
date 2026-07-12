import "@xterm/xterm/css/xterm.css";
import type {
  TerminalConnectionState,
  TerminalLifecycle,
  TerminalServerMessage,
} from "@openducktor/contracts";
import { FitAddon } from "@xterm/addon-fit";
import { type ITheme, Terminal } from "@xterm/xterm";
import { type ReactElement, useEffect, useRef, useState } from "react";
import type { TerminalTransportController } from "@/pages/agents/terminals/terminal-transport-controller";

const readCssVariable = (element: HTMLElement, name: string): string =>
  getComputedStyle(element).getPropertyValue(name).trim();

const terminalTheme = (container: HTMLElement): ITheme => ({
  background: readCssVariable(container, "--dev-server-terminal-panel"),
  foreground: readCssVariable(container, "--dev-server-terminal-foreground"),
  cursor: readCssVariable(container, "--dev-server-terminal-foreground"),
  cursorAccent: readCssVariable(container, "--dev-server-terminal-panel"),
  selectionBackground: readCssVariable(container, "--dev-server-terminal-selection"),
  selectionInactiveBackground: readCssVariable(
    container,
    "--dev-server-terminal-selection-inactive",
  ),
});

export function InteractiveTerminal({
  terminalId,
  controller,
  active,
  focusRequest,
  onAttention,
  onConnectionState,
  onLifecycle,
}: {
  terminalId: string;
  controller: TerminalTransportController;
  active: boolean;
  focusRequest: number;
  onAttention: (message: string | null) => void;
  onConnectionState: (state: TerminalConnectionState) => void;
  onLifecycle: (lifecycle: TerminalLifecycle, exitText: string | null) => void;
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const [interactionError, setInteractionError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let generation = 0;
    let pendingResize: { columns: number; rows: number } | null = null;
    let resizeScheduled = false;
    let writeQueue = Promise.resolve();
    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.35,
      screenReaderMode: true,
      scrollback: 2000,
      theme: terminalTheme(container),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    const flushResize = (): void => {
      resizeScheduled = false;
      const grid = pendingResize;
      pendingResize = null;
      if (grid) void controller.resize(terminalId, grid.columns, grid.rows);
    };
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      pendingResize = { columns: cols, rows };
      if (!resizeScheduled) {
        resizeScheduled = true;
        queueMicrotask(flushResize);
      }
    });
    const dataSubscription = terminal.onData((data) => {
      if (pendingResize) flushResize();
      void controller.write(terminalId, new TextEncoder().encode(data));
    });
    const oscClipboardSubscription = terminal.parser.registerOscHandler(52, () => true);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const copy =
        (isMac && event.metaKey && event.key.toLowerCase() === "c") ||
        (!isMac && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "c") ||
        (!isMac && event.ctrlKey && event.key.toLowerCase() === "c" && terminal.hasSelection());
      if (copy && terminal.hasSelection()) {
        void navigator.clipboard.writeText(terminal.getSelection()).catch((cause: unknown) => {
          setInteractionError(cause instanceof Error ? cause.message : String(cause));
        });
        return false;
      }
      const paste =
        (isMac && event.metaKey && event.key.toLowerCase() === "v") ||
        (!isMac && event.ctrlKey && event.shiftKey && event.key.toLowerCase() === "v");
      if (paste) {
        void navigator.clipboard
          .readText()
          .then((text) => controller.write(terminalId, new TextEncoder().encode(text)))
          .catch((cause: unknown) => {
            setInteractionError(cause instanceof Error ? cause.message : String(cause));
          });
        return false;
      }
      if (event.ctrlKey && event.key.toLowerCase() === "c" && !terminal.hasSelection()) {
        void controller.write(terminalId, new Uint8Array([3]));
        return false;
      }
      return true;
    });
    const handleFrame = (message: TerminalServerMessage, payload: Uint8Array): void => {
      if (message.type === "snapshot") {
        onConnectionState(message.complete ? "connected" : "incomplete_replay");
        onLifecycle(message.lifecycle, null);
        return;
      }
      if (message.type === "replay_gap") {
        terminal.reset();
        onConnectionState("incomplete_replay");
        onAttention(
          `Incomplete replay: output ${message.missingSequenceStart}–${message.missingSequenceEnd} is unavailable.`,
        );
        return;
      }
      if (message.type === "output_overflow") {
        onAttention("Output overflow stopped this terminal.");
        return;
      }
      if (message.type === "lifecycle") {
        const exitText =
          message.lifecycle === "exited"
            ? `Exited with code ${message.exitCode ?? "unknown"}${message.signal ? ` (${message.signal})` : ""}.`
            : null;
        onLifecycle(message.lifecycle, exitText);
        return;
      }
      if (message.type !== "output") return;
      const expectedGeneration = generation;
      writeQueue = writeQueue.then(
        () =>
          new Promise<void>((resolve) => {
            terminal.write(payload, () => {
              if (generation === expectedGeneration) {
                void controller.acknowledge(terminalId, message.sequenceEnd);
              }
              resolve();
            });
          }),
      );
    };
    onConnectionState("attaching");
    const unsubscribe = controller.subscribe(terminalId, handleFrame);
    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(container);
    fitAddon.fit();
    return () => {
      generation += 1;
      unsubscribe();
      observer.disconnect();
      oscClipboardSubscription.dispose();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      fitAddon.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [controller, onAttention, onConnectionState, onLifecycle, terminalId]);

  useEffect(() => {
    if (active && focusRequest > 0) terminalRef.current?.focus();
  }, [active, focusRequest]);

  return (
    <div className="relative h-full min-h-0 bg-[var(--dev-server-terminal-panel)]">
      <div
        ref={containerRef}
        className="h-full min-h-0 px-2 py-1"
        role="application"
        aria-label={`Interactive terminal ${terminalId}`}
      />
      {interactionError ? (
        <p className="absolute inset-x-2 bottom-2 rounded-md bg-destructive px-2 py-1 text-xs text-destructive-foreground">
          Clipboard failed: {interactionError}
        </p>
      ) : null}
    </div>
  );
}
