import "@xterm/xterm/css/xterm.css";
import type { AppPlatform, TerminalLifecycle, TerminalServerMessage } from "@openducktor/contracts";
import { useQuery } from "@tanstack/react-query";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { type IDisposable, Terminal } from "@xterm/xterm";
import { type ReactElement, useEffect, useEffectEvent, useRef, useState } from "react";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { stageLocalAttachmentFile } from "@/lib/local-attachment-files";
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
import {
  containsTransferredImage,
  createTerminalImagePasteHandler,
  extractTransferredImageFiles,
  pasteDroppedTerminalImages,
} from "./terminal-image-transfer-policy";
import { createTerminalKeyEventHandler, encodeTerminalTextInput } from "./terminal-keyboard-policy";

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
  const [rendererError, setRendererError] = useState<string | null>(null);
  const [isImageDragActive, setIsImageDragActive] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const isActive = useEffectEvent(() => active);

  useEffect(() => {
    platformRef.current = platformQuery.data;
  }, [platformQuery.data]);

  useEffect(() => {
    if (!platformQuery.isError) return;
    const toastId = `terminal:${terminalId}:platform`;
    toast.error("Terminal shortcuts unavailable", {
      id: toastId,
      description: platformQuery.error.message,
    });
    return () => {
      toast.dismiss(toastId);
    };
  }, [platformQuery.error, platformQuery.isError, terminalId]);

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
    setIsImageDragActive(false);
    setRendererError(null);
    let generation = 0;
    const interactionToastId = `terminal:${terminalId}:interaction`;
    const reportInteractionFailure = (title: string, cause: unknown): void => {
      if (generation !== 0) return;
      toast.error(title, {
        id: interactionToastId,
        description: errorMessage(cause),
      });
    };
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
          if (generation !== 0) return;
          setRendererError("The terminal renderer stopped responding.");
        },
      });
    } catch (cause) {
      terminal.dispose();
      setRendererError(errorMessage(cause));
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
        void controller
          .acknowledge(terminalId, sequenceEnd)
          .catch((cause) => reportInteractionFailure("Terminal output sync failed", cause));
      },
      onHydrated: () => {
        if (generation !== 0) return;
        setIsHydrated(true);
      },
    });
    const enqueueInput = createTerminalInputSequencer({
      writeInput: (data) => controller.write(terminalId, data),
      reportFailure: (cause) => reportInteractionFailure("Terminal input failed", cause),
    });
    const resizeScheduler = createLatestResizeScheduler((columns, rows) => {
      void controller
        .resize(terminalId, columns, rows)
        .catch((cause) => reportInteractionFailure("Terminal resize failed", cause));
    });
    const resizeSubscription = terminal.onResize(({ cols, rows }) => {
      resizeScheduler.schedule(cols, rows);
    });
    const dataSubscription = terminal.onData((data) => {
      const input = encodeTerminalTextInput(data);
      if (!input) return;
      resizeScheduler.flush();
      void enqueueInput(() => input);
    });
    const oscClipboardSubscription = terminal.parser.registerOscHandler(52, () => true);
    terminal.attachCustomKeyEventHandler(
      createTerminalKeyEventHandler({
        getPlatform: () => platformRef.current,
        hasSelection: () => terminal.hasSelection(),
        getSelection: () => terminal.getSelection(),
        writeClipboard: (text) => navigator.clipboard.writeText(text),
        enqueueInput,
        reportFailure: (cause) => reportInteractionFailure("Clipboard action failed", cause),
      }),
    );
    const handleImagePaste = createTerminalImagePasteHandler({ enqueueInput });
    const handleImageDragEnter = (event: DragEvent): void => {
      if (!containsTransferredImage(event.dataTransfer)) return;
      event.preventDefault();
      setIsImageDragActive(true);
    };
    const handleImageDragOver = (event: DragEvent): void => {
      if (!containsTransferredImage(event.dataTransfer)) return;
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
    };
    const handleImageDragLeave = (event: DragEvent): void => {
      if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return;
      setIsImageDragActive(false);
    };
    const handleImageDrop = (event: DragEvent): void => {
      const files = extractTransferredImageFiles(event.dataTransfer);
      if (files.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      setIsImageDragActive(false);
      const platform = platformRef.current;
      if (!platform) {
        reportInteractionFailure(
          "Image drop failed",
          new Error("The host platform is still loading. Try dropping the image again."),
        );
        return;
      }
      void pasteDroppedTerminalImages({
        files,
        platform,
        stageFile: stageLocalAttachmentFile,
        paste: (value) => {
          if (generation !== 0) return;
          terminal.paste(value);
          terminal.focus();
        },
      }).catch((cause) => reportInteractionFailure("Image drop failed", cause));
    };
    container.addEventListener("paste", handleImagePaste, true);
    container.addEventListener("dragenter", handleImageDragEnter);
    container.addEventListener("dragover", handleImageDragOver);
    container.addEventListener("dragleave", handleImageDragLeave);
    container.addEventListener("drop", handleImageDrop);
    const handleFrame = (message: TerminalServerMessage, payload: Uint8Array): void => {
      if (message.type === "snapshot") {
        outputSequencer.setSnapshotBoundary(message.snapshotSequenceEnd);
      }
      const isReplayGap = message.type === "replay_gap";
      if (isReplayGap) {
        void outputSequencer
          .skipTo(message.missingSequenceEnd, () => terminal.reset())
          .catch((cause) => reportInteractionFailure("Terminal output failed", cause));
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
      void outputSequencer
        .enqueue(message, payload)
        .catch((cause) => reportInteractionFailure("Terminal output failed", cause));
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
      container.removeEventListener("paste", handleImagePaste, true);
      container.removeEventListener("dragenter", handleImageDragEnter);
      container.removeEventListener("dragover", handleImageDragOver);
      container.removeEventListener("dragleave", handleImageDragLeave);
      container.removeEventListener("drop", handleImageDrop);
      toast.dismiss(interactionToastId);
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

  return (
    <div className="relative h-full min-h-0 bg-[var(--dev-server-terminal-panel)]">
      <div
        ref={containerRef}
        className={cn("h-full min-h-0 px-2 py-1", (!isHydrated || rendererError) && "invisible")}
        role="application"
        aria-label={`Interactive terminal ${terminalId}`}
      />
      {isImageDragActive ? (
        <div
          role="status"
          className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-md border border-dashed border-primary bg-background/90 text-sm font-medium text-foreground"
        >
          Drop image to paste its path
        </div>
      ) : null}
      {rendererError ? (
        <div className="absolute inset-0 flex items-center justify-center bg-[var(--dev-server-terminal-panel)] p-6">
          <div role="alert" className="flex max-w-md flex-col items-center gap-2 text-center">
            <p className="text-sm font-semibold text-foreground">Terminal renderer unavailable</p>
            <p className="text-xs text-muted-foreground">
              {rendererError} Close and reopen this terminal tab.
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
