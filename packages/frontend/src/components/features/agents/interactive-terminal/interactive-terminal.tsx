import "@xterm/xterm/css/xterm.css";
import type { AppPlatform, TerminalLifecycle, TerminalServerMessage } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { type IDisposable, Terminal } from "@xterm/xterm";
import { type ReactElement, useEffect, useEffectEvent, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { TerminalTransportController } from "@/pages/agents/terminals/terminal-transport-controller";
import { platformQueryOptions } from "@/state/queries/system";
import { createTerminalOptions } from "../terminal-xterm-options";
import {
  createLatestResizeScheduler,
  createLiveTerminalFitScheduler,
  createTerminalInputSequencer,
  createTerminalOutputSequencer,
  createTerminalViewportActivator,
  handleTerminalMetadataFrame,
} from "./interactive-terminal-policy";
import {
  attachInteractiveTerminalRenderer,
  createBufferedTerminalFitter,
} from "./interactive-terminal-renderer";
import { createTerminalKeyEventHandler } from "./terminal-keyboard-policy";

export function InteractiveTerminal({
  terminalId,
  controller,
  active,
  focusRequest,
  onAttention,
  onLifecycle,
  onForgotten,
  onTitleChange,
}: {
  terminalId: string;
  controller: TerminalTransportController;
  active: boolean;
  focusRequest: number;
  onAttention: (message: string | null) => void;
  onLifecycle: (lifecycle: TerminalLifecycle, exitText: string | null) => void;
  onForgotten: (message: string) => void;
  onTitleChange: (title: string) => void;
}): ReactElement {
  const platformQuery = useQuery(platformQueryOptions());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const platformRef = useRef<AppPlatform | undefined>(platformQuery.data);
  const activateViewportRef = useRef<((focus: (() => void) | null) => void) | null>(null);
  const callbacksRef = useRef({
    onAttention,
    onLifecycle,
    onForgotten,
    onTitleChange,
  });
  const [interactionError, setInteractionError] = useState<string | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const isActive = useEffectEvent(() => active);

  useEffect(() => {
    platformRef.current = platformQuery.data;
  }, [platformQuery.data]);

  useEffect(() => {
    callbacksRef.current = {
      onAttention,
      onLifecycle,
      onForgotten,
      onTitleChange,
    };
  }, [onAttention, onForgotten, onLifecycle, onTitleChange]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    setIsHydrated(false);
    const reportInteractionFailure = (cause: unknown): void => {
      setInteractionError(cause instanceof Error ? cause.message : String(cause));
    };
    let generation = 0;
    const terminal = new Terminal(
      createTerminalOptions(container, {
        cursorBlink: true,
        screenReaderMode: true,
      }),
    );
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    let rendererContextLossSubscription: IDisposable;
    try {
      rendererContextLossSubscription = attachInteractiveTerminalRenderer({
        terminal,
        renderer: new WebglAddon(/* preserveDrawingBuffer */ true),
        onContextLoss: () => {
          reportInteractionFailure(
            new Error("The terminal renderer was lost. Reopen this terminal tab."),
          );
        },
      });
    } catch (cause) {
      terminal.dispose();
      reportInteractionFailure(cause);
      return;
    }
    const terminalFitter = createBufferedTerminalFitter({ container, terminal, fitAddon });
    terminalRef.current = terminal;
    activateViewportRef.current = createTerminalViewportActivator({
      fit: terminalFitter.fit,
      scrollToBottom: () => terminal.scrollToBottom(),
      refresh: (start, end) => terminal.refresh(start, end),
      readRows: () => terminal.rows,
    });
    const outputSequencer = createTerminalOutputSequencer({
      write: (payload, parsed) => terminal.write(payload, parsed),
      onConsumed: (sequenceEnd) => {
        if (generation !== 0) return;
        void controller.acknowledge(terminalId, sequenceEnd).catch(reportInteractionFailure);
      },
      onHydrated: () => {
        if (generation !== 0) return;
        setIsHydrated(true);
      },
    });
    const enqueueInput = createTerminalInputSequencer({
      writeInput: (data) => controller.write(terminalId, data),
      reportFailure: reportInteractionFailure,
    });
    const resizeScheduler = createLatestResizeScheduler((columns, rows) => {
      void controller.resize(terminalId, columns, rows).catch(reportInteractionFailure);
    });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      resizeScheduler.schedule(cols, rows);
    });
    const dataSubscription = terminal.onData((data) => {
      resizeScheduler.flush();
      void enqueueInput(() => new TextEncoder().encode(data));
    });
    const oscClipboardSubscription = terminal.parser.registerOscHandler(52, () => true);
    terminal.attachCustomKeyEventHandler(
      createTerminalKeyEventHandler({
        getPlatform: () => platformRef.current,
        hasSelection: () => terminal.hasSelection(),
        getSelection: () => terminal.getSelection(),
        writeClipboard: (text) => navigator.clipboard.writeText(text),
        readClipboard: () => navigator.clipboard.readText(),
        enqueueInput,
        reportFailure: reportInteractionFailure,
      }),
    );
    const handleFrame = (message: TerminalServerMessage, payload: Uint8Array): void => {
      if (message.type === "snapshot") {
        outputSequencer.setSnapshotBoundary(message.snapshotSequenceEnd);
      }
      const isReplayGap = message.type === "replay_gap";
      if (isReplayGap) {
        void outputSequencer
          .skipTo(message.missingSequenceEnd, () => terminal.reset())
          .catch(reportInteractionFailure);
      }
      if (
        handleTerminalMetadataFrame(message, {
          reset: isReplayGap ? () => undefined : () => terminal.reset(),
          onAttention: callbacksRef.current.onAttention,
          onLifecycle: callbacksRef.current.onLifecycle,
          onTitle: callbacksRef.current.onTitleChange,
          onForgotten: callbacksRef.current.onForgotten,
          onFailure: callbacksRef.current.onAttention,
        })
      )
        return;
      void outputSequencer.enqueue(message, payload).catch(reportInteractionFailure);
    };
    const unsubscribe = controller.subscribe(terminalId, handleFrame);
    const fitScheduler = createLiveTerminalFitScheduler({
      fit: terminalFitter.fit,
      isActive,
    });
    const observer = new ResizeObserver(() => fitScheduler.schedule());
    observer.observe(container);
    if (isActive()) terminalFitter.fit();
    return () => {
      generation += 1;
      controller.releaseEmulator(terminalId);
      unsubscribe();
      observer.disconnect();
      fitScheduler.dispose();
      terminalFitter.dispose();
      oscClipboardSubscription.dispose();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      rendererContextLossSubscription.dispose();
      fitAddon.dispose();
      terminal.dispose();
      terminalRef.current = null;
      activateViewportRef.current = null;
    };
  }, [controller, terminalId]);

  useEffect(() => {
    if (!active || !isHydrated) return;
    const frameId = requestAnimationFrame(() => {
      const terminal = terminalRef.current;
      const activateViewport = activateViewportRef.current;
      if (!terminal || !activateViewport) return;
      activateViewport(focusRequest > 0 ? () => terminal.focus() : null);
    });
    return () => cancelAnimationFrame(frameId);
  }, [active, focusRequest, isHydrated]);

  const visibleInteractionError = platformQuery.isError
    ? platformQuery.error.message
    : interactionError;

  return (
    <div className="relative h-full min-h-0 bg-[var(--dev-server-terminal-panel)]">
      <div
        ref={containerRef}
        className={cn("h-full min-h-0 px-2 py-1", !isHydrated && "invisible")}
        role="application"
        aria-label={`Interactive terminal ${terminalId}`}
      />
      {visibleInteractionError ? (
        <p
          role="alert"
          className="absolute inset-x-2 bottom-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive"
        >
          Terminal interaction failed: {visibleInteractionError}
        </p>
      ) : null}
    </div>
  );
}
