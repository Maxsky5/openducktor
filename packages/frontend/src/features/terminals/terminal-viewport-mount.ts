import {
  TERMINAL_PROTOCOL_MAX_INPUT_BYTES,
  type AppPlatform,
  type TerminalLifecycle,
  type TerminalServerMessage,
} from "@openducktor/contracts";
import {
  createLatestResizeScheduler,
  createLiveTerminalFitScheduler,
  createTerminalInputSequencer,
  createTerminalViewportActivator,
  handleTerminalMetadataFrame,
} from "./terminal-viewport-policy";
import {
  containsTransferredImage,
  createTerminalImagePasteHandler,
  extractTransferredImageFiles,
  pasteDroppedTerminalImages,
} from "./terminal-image-transfer-policy";
import { createTerminalKeyEventHandler, encodeTerminalTextInput } from "./terminal-keyboard-policy";
import type { TerminalTransportController } from "./terminal-transport-controller";
import { createTerminalOptions } from "./terminal-xterm-options";
import { restoreTerminalPrecedingJoinState } from "./terminal-rep-state";
import { createTerminalBinding } from "./shared-terminal-binding";
import { createTerminalOutputSequencer } from "./terminal-output-sequencer";

export type TerminalViewportMount = {
  activate(focus: boolean): void;
  dispose(): void;
};

type MountTerminalViewportInput = {
  mode?: "interactive" | "output";
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
  onInteractionFailure: (title: string, cause: unknown) => void;
};

export const mountTerminalViewport = ({
  mode = "interactive",
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
  onInteractionFailure,
}: MountTerminalViewportInput): TerminalViewportMount => {
  let disposed = false;
  const reportFailure = (title: string, cause: unknown): void => {
    if (!disposed) onInteractionFailure(title, cause);
  };
  const binding = createTerminalBinding(
    container,
    createTerminalOptions(container, {
      cursorBlink: mode === "interactive",
      screenReaderMode: true,
      disableStdin: mode === "output",
      convertEol: mode === "output",
    }),
  );
  const { fitAddon, terminal } = binding;
  let restoringScreen = false;
  let restoreGeneration = 0;
  let inputGate: Promise<void> | null = null;
  let releaseInput: (() => void) | null = null;
  let deferredInputBytes = 0;
  const resetTerminal = (): void => {
    binding.resetLinkState();
    terminal.reset();
  };
  const fitViewport = (): void => {
    if (restoringScreen) return;
    const style = getComputedStyle(container);
    const contentWidth =
      container.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
    const contentHeight =
      container.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
    // FitAddon clamps a collapsed panel to 2x1, which can erase screen output.
    if (contentWidth <= 0 || contentHeight <= 0) return;
    const proposed = fitAddon.proposeDimensions();
    if (!proposed || proposed.cols <= 2 || proposed.rows <= 1) return;
    fitAddon.fit();
  };
  const activateViewport = createTerminalViewportActivator({
    fit: fitViewport,
    scrollToBottom: () => terminal.scrollToBottom(),
    refresh: (start, end) => terminal.refresh(start, end),
    readRows: () => terminal.rows,
  });
  const fitScheduler = createLiveTerminalFitScheduler({ fit: fitViewport, isActive });
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
  const resizeScheduler = createLatestResizeScheduler((columns, rows) => {
    void controller
      .resize(terminalId, columns, rows)
      .catch((cause) => reportFailure("Terminal resize failed", cause));
  });
  const enqueueInput = createTerminalInputSequencer({
    isActive,
    writeInput: async (data) => {
      if (inputGate) await inputGate;
      if (disposed) return;
      fitScheduler.flush();
      resizeScheduler.flush();
      await controller.write(terminalId, data);
    },
    reportFailure: (cause) => reportFailure("Terminal input failed", cause),
  });
  const resizeSubscription = terminal.onResize(({ cols, rows }) => {
    if (restoringScreen) return;
    resizeScheduler.schedule(cols, rows);
  });
  const dataSubscription = terminal.onData((data) => {
    if (mode === "output") return;
    const input = encodeTerminalTextInput(data);
    if (!input) return;
    if (restoringScreen) {
      deferredInputBytes += input.byteLength;
      if (deferredInputBytes > TERMINAL_PROTOCOL_MAX_INPUT_BYTES) {
        deferredInputBytes -= input.byteLength;
        reportFailure(
          "Terminal input failed",
          new Error("Terminal input during screen restore exceeds the 64 KiB limit."),
        );
        return;
      }
    }
    void enqueueInput(() => input);
  });
  const oscClipboardSubscription = terminal.parser.registerOscHandler(52, () => true);
  terminal.attachCustomKeyEventHandler(
    createTerminalKeyEventHandler({
      getPlatform,
      readOnly: mode === "output",
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
        if (disposed || !isActive()) return;
        terminal.paste(value);
        terminal.focus();
      },
    }).catch((cause) => reportFailure("Image drop failed", cause));
  };
  if (mode === "interactive") {
    container.addEventListener("paste", handleImagePaste, true);
    container.addEventListener("dragenter", handleImageDragEnter);
    container.addEventListener("dragover", handleImageDragOver);
    container.addEventListener("dragleave", handleImageDragLeave);
    container.addEventListener("drop", handleImageDrop);
  }

  const handleFrame = (message: TerminalServerMessage, payload: Uint8Array): void => {
    if (message.type === "snapshot") {
      outputSequencer.setSnapshotBoundary(message.snapshotSequenceEnd);
    }
    if (message.type === "screen_restore") {
      const generation = ++restoreGeneration;
      restoringScreen = true;
      if (!inputGate) {
        inputGate = new Promise<void>((resolve) => {
          releaseInput = resolve;
        });
      }
      void outputSequencer
        .restore(
          message.sequenceEnd,
          payload,
          () => {
            resetTerminal();
            terminal.resize(message.columns, message.rows);
          },
          (completed) => {
            if (generation !== restoreGeneration) return;
            restoringScreen = false;
            try {
              if (completed)
                restoreTerminalPrecedingJoinState(terminal, message.precedingJoinState);
              if (isActive()) fitViewport();
              resizeScheduler.flush();
            } finally {
              deferredInputBytes = 0;
              releaseInput?.();
              releaseInput = null;
              inputGate = null;
            }
          },
        )
        .catch((cause) => reportFailure("Terminal output failed", cause));
      return;
    }
    if (
      handleTerminalMetadataFrame(message, {
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
  const observer = new ResizeObserver(() => fitScheduler.schedule());
  observer.observe(container);
  if (isActive()) fitViewport();

  return {
    activate: (focus) => {
      binding.resetLinkState();
      activateViewport(focus ? () => terminal.focus() : null);
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      outputSequencer.dispose();
      releaseInput?.();
      releaseInput = null;
      inputGate = null;
      controller.releaseEmulator(terminalId);
      unsubscribe();
      observer.disconnect();
      fitScheduler.dispose();
      container.removeEventListener("paste", handleImagePaste, true);
      container.removeEventListener("dragenter", handleImageDragEnter);
      container.removeEventListener("dragover", handleImageDragOver);
      container.removeEventListener("dragleave", handleImageDragLeave);
      container.removeEventListener("drop", handleImageDrop);
      oscClipboardSubscription.dispose();
      dataSubscription.dispose();
      resizeSubscription.dispose();
      binding.dispose();
    },
  };
};
