import type { AppPlatform, TerminalLifecycle, TerminalServerMessage } from "@openducktor/contracts";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { type IDisposable, Terminal } from "@xterm/xterm";
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
import type { TerminalTransportController } from "./terminal-transport-controller";
import { createTerminalOptions } from "./terminal-xterm-options";

export type InteractiveTerminalMount = {
  activate(focus: boolean): void;
  dispose(): void;
};

type MountInteractiveTerminalInput = {
  container: HTMLDivElement;
  terminalId: string;
  controller: TerminalTransportController;
  isActive: () => boolean;
  getPlatform: () => AppPlatform | undefined;
  stageFile: (file: File) => Promise<string>;
  preparePathInput: (paths: readonly string[]) => Promise<string>;
  writeClipboard: (text: string) => Promise<void>;
  onAttention: (message: string | null) => void;
  onLifecycle: (lifecycle: TerminalLifecycle, exitText: string | null) => void;
  onForgotten: (message: string) => void;
  onTitleChange: (title: string) => void;
  onHydrated: () => void;
  onImageDragActiveChange: (active: boolean) => void;
  onRendererError: (message: string) => void;
  onInteractionFailure: (title: string, cause: unknown) => void;
};

export const mountInteractiveTerminal = ({
  container,
  terminalId,
  controller,
  isActive,
  getPlatform,
  stageFile,
  preparePathInput,
  writeClipboard,
  onAttention,
  onLifecycle,
  onForgotten,
  onTitleChange,
  onHydrated,
  onImageDragActiveChange,
  onRendererError,
  onInteractionFailure,
}: MountInteractiveTerminalInput): InteractiveTerminalMount => {
  let disposed = false;
  const reportFailure = (title: string, cause: unknown): void => {
    if (!disposed) onInteractionFailure(title, cause);
  };
  const terminal = new Terminal(
    createTerminalOptions(container, { cursorBlink: true, screenReaderMode: true }),
  );
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);
  let rendererSubscription: IDisposable;
  try {
    rendererSubscription = attachInteractiveTerminalRenderer({
      terminal,
      renderer: new WebglAddon(/* preserveDrawingBuffer */ true),
      onContextLoss: () => {
        if (!disposed) onRendererError("The terminal renderer stopped responding.");
      },
    });
  } catch (cause) {
    fitAddon.dispose();
    terminal.dispose();
    throw cause;
  }

  const terminalFitter = createBufferedTerminalFitter({ container, terminal, fitAddon });
  const activateViewport = createTerminalViewportActivator({
    fit: terminalFitter.fit,
    scrollToBottom: () => terminal.scrollToBottom(),
    refresh: (start, end) => terminal.refresh(start, end),
    readRows: () => terminal.rows,
  });
  const outputSequencer = createTerminalOutputSequencer({
    write: (payload, parsed) => terminal.write(payload, parsed),
    onConsumed: (sequenceEnd) => {
      if (disposed) return;
      void controller
        .acknowledge(terminalId, sequenceEnd)
        .catch((cause) => reportFailure("Terminal output sync failed", cause));
    },
    onHydrated: () => {
      if (!disposed) onHydrated();
    },
  });
  const enqueueInput = createTerminalInputSequencer({
    writeInput: (data) => controller.write(terminalId, data),
    reportFailure: (cause) => reportFailure("Terminal input failed", cause),
  });
  const resizeScheduler = createLatestResizeScheduler((columns, rows) => {
    void controller
      .resize(terminalId, columns, rows)
      .catch((cause) => reportFailure("Terminal resize failed", cause));
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
      getPlatform,
      hasSelection: () => terminal.hasSelection(),
      getSelection: () => terminal.getSelection(),
      writeClipboard,
      enqueueInput,
      reportFailure: (cause) => reportFailure("Clipboard action failed", cause),
    }),
  );

  const handleImagePaste = createTerminalImagePasteHandler({ enqueueInput });
  const handleImageDragEnter = (event: DragEvent): void => {
    if (!containsTransferredImage(event.dataTransfer)) return;
    event.preventDefault();
    onImageDragActiveChange(true);
  };
  const handleImageDragOver = (event: DragEvent): void => {
    if (!containsTransferredImage(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  };
  const handleImageDragLeave = (event: DragEvent): void => {
    if (event.relatedTarget instanceof Node && container.contains(event.relatedTarget)) return;
    onImageDragActiveChange(false);
  };
  const handleImageDrop = (event: DragEvent): void => {
    const files = extractTransferredImageFiles(event.dataTransfer);
    if (files.length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    onImageDragActiveChange(false);
    void pasteDroppedTerminalImages({
      files,
      stageFile,
      prepareInput: preparePathInput,
      paste: (value) => {
        if (disposed) return;
        terminal.paste(value);
        terminal.focus();
      },
    }).catch((cause) => reportFailure("Image drop failed", cause));
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
        .catch((cause) => reportFailure("Terminal output failed", cause));
    }
    if (
      handleTerminalMetadataFrame(message, {
        reset: isReplayGap ? () => undefined : () => terminal.reset(),
        onAttention,
        onLifecycle,
        onTitle: onTitleChange,
        onForgotten,
        onFailure: onAttention,
      })
    ) {
      return;
    }
    void outputSequencer
      .enqueue(message, payload)
      .catch((cause) => reportFailure("Terminal output failed", cause));
  };
  const unsubscribe = controller.subscribe(terminalId, handleFrame);
  const fitScheduler = createLiveTerminalFitScheduler({ fit: terminalFitter.fit, isActive });
  const observer = new ResizeObserver(() => fitScheduler.schedule());
  observer.observe(container);
  if (isActive()) terminalFitter.fit();

  return {
    activate: (focus) => activateViewport(focus ? () => terminal.focus() : null),
    dispose: () => {
      if (disposed) return;
      disposed = true;
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
      oscClipboardSubscription.dispose();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      rendererSubscription.dispose();
      fitAddon.dispose();
      terminal.dispose();
    },
  };
};
