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
import {
  createLatestResizeScheduler,
  enqueueParsedTerminalWrite,
  resolveTerminalKeyAction,
} from "./interactive-terminal-policy";

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
  const callbacksRef = useRef({ onAttention, onConnectionState, onLifecycle });
  const [interactionError, setInteractionError] = useState<string | null>(null);

  useEffect(() => {
    callbacksRef.current = { onAttention, onConnectionState, onLifecycle };
  }, [onAttention, onConnectionState, onLifecycle]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let generation = 0;
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
    const reportInteractionFailure = (cause: unknown): void => {
      setInteractionError(cause instanceof Error ? cause.message : String(cause));
    };
    const resizeScheduler = createLatestResizeScheduler((columns, rows) => {
      void controller.resize(terminalId, columns, rows).catch(reportInteractionFailure);
    });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      resizeScheduler.schedule(cols, rows);
    });
    const dataSubscription = terminal.onData((data) => {
      resizeScheduler.flush();
      void controller
        .write(terminalId, new TextEncoder().encode(data))
        .catch(reportInteractionFailure);
    });
    const oscClipboardSubscription = terminal.parser.registerOscHandler(52, () => true);
    terminal.attachCustomKeyEventHandler((event) => {
      if (event.type !== "keydown") return true;
      const isMac = navigator.platform.toLowerCase().includes("mac");
      const action = resolveTerminalKeyAction(event, isMac, terminal.hasSelection());
      if (action === "copy") {
        void navigator.clipboard.writeText(terminal.getSelection()).catch(reportInteractionFailure);
        return false;
      }
      if (action === "paste") {
        void navigator.clipboard
          .readText()
          .then((text) => controller.write(terminalId, new TextEncoder().encode(text)))
          .catch(reportInteractionFailure);
        return false;
      }
      if (action === "interrupt") {
        void controller.write(terminalId, new Uint8Array([3])).catch(reportInteractionFailure);
        return false;
      }
      return true;
    });
    const handleFrame = (message: TerminalServerMessage, payload: Uint8Array): void => {
      if (message.type === "snapshot") {
        callbacksRef.current.onConnectionState(
          message.complete ? "connected" : "incomplete_replay",
        );
        callbacksRef.current.onLifecycle(message.lifecycle, null);
        return;
      }
      if (message.type === "replay_gap") {
        terminal.reset();
        callbacksRef.current.onConnectionState("incomplete_replay");
        callbacksRef.current.onAttention(
          `Incomplete replay: output ${message.missingSequenceStart}–${message.missingSequenceEnd} is unavailable.`,
        );
        return;
      }
      if (message.type === "output_overflow") {
        callbacksRef.current.onAttention("Output overflow stopped this terminal.");
        return;
      }
      if (message.type === "lifecycle") {
        const exitText =
          message.lifecycle === "exited"
            ? `Exited with code ${message.exitCode ?? "unknown"}${message.signal ? ` (${message.signal})` : ""}.`
            : null;
        callbacksRef.current.onLifecycle(message.lifecycle, exitText);
        return;
      }
      if (message.type !== "output") return;
      const expectedGeneration = generation;
      writeQueue = enqueueParsedTerminalWrite(
        writeQueue,
        (bytes, parsed) => terminal.write(bytes, parsed),
        payload,
        () => {
          if (generation === expectedGeneration) {
            void controller
              .acknowledge(terminalId, message.sequenceEnd)
              .catch(reportInteractionFailure);
          }
        },
      );
    };
    callbacksRef.current.onConnectionState("attaching");
    const unsubscribe = controller.subscribe(terminalId, handleFrame);
    const observer = new ResizeObserver(() => fitAddon.fit());
    observer.observe(container);
    fitAddon.fit();
    return () => {
      generation += 1;
      controller.releaseEmulator(terminalId);
      unsubscribe();
      observer.disconnect();
      oscClipboardSubscription.dispose();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      fitAddon.dispose();
      terminal.dispose();
      terminalRef.current = null;
    };
  }, [controller, terminalId]);

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
          Terminal interaction failed: {interactionError}
        </p>
      ) : null}
    </div>
  );
}
