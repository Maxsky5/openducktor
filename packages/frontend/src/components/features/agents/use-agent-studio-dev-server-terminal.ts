import { FitAddon } from "@xterm/addon-fit";
import { type ITerminalOptions, type ITheme, Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import type { AgentStudioDevServerTerminalBuffer } from "@/features/agent-studio-build-tools/dev-server-log-buffer";

export type TerminalBinding = {
  terminal: Pick<Terminal, "clear" | "dispose" | "loadAddon" | "open" | "options" | "reset"> & {
    attachCustomKeyEventHandler?(handler: (event: KeyboardEvent) => boolean): void;
    getSelection?(): string;
    hasSelection?(): boolean;
    write(data: string, callback?: () => void): void;
  };
  fitAddon: Pick<FitAddon, "dispose" | "fit">;
};

export type CreateTerminalBinding = (
  container: HTMLElement,
  options: ITerminalOptions,
) => TerminalBinding;

type RenderedTerminalState = {
  scriptId: string | null;
  resetToken: number | null;
  lastSequence: number | null;
};

type TerminalRenderController = {
  bindingRef: { current: TerminalBinding | null };
  renderedStateRef: { current: RenderedTerminalState };
  renderQueueRef: { current: Promise<void> | null };
  renderGenerationRef: { current: number };
  pendingTerminalWritesRef: PendingTerminalWritesRef;
  recreateTerminalBinding: () => TerminalBinding | null;
};

type UseDevServerTerminalBindingArgs = {
  containerRef: { current: HTMLDivElement | null };
  createTerminalBinding: CreateTerminalBinding;
  onRendererError: (message: string | null) => void;
};

type UseDevServerTerminalRenderingArgs = TerminalRenderController & {
  scriptId: string;
  terminalBuffer: AgentStudioDevServerTerminalBuffer | null;
  onRendererError: (message: string | null) => void;
};

type PendingTerminalWritesRef = { current: Set<symbol> };

const TERMINAL_WRITE_ACK_TIMEOUT_MS = 50;

const readCssVariable = (element: HTMLElement, name: string): string => {
  return getComputedStyle(element).getPropertyValue(name).trim();
};

const buildTerminalTheme = (container: HTMLElement): ITheme => ({
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

export const defaultCreateTerminalBinding: CreateTerminalBinding = (container, options) => {
  const terminal = new Terminal(options);
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);
  fitAddon.fit();
  return { terminal, fitAddon };
};

const terminalOptions = (container: HTMLElement): ITerminalOptions => ({
  allowTransparency: true,
  convertEol: false,
  cursorBlink: false,
  disableStdin: true,
  fontFamily: 'Menlo, Monaco, "Courier New", monospace',
  fontSize: 12,
  lineHeight: 1.35,
  scrollback: 2000,
  theme: buildTerminalTheme(container),
});

const trackPendingTerminalWrite = (
  pendingTerminalWritesRef: PendingTerminalWritesRef,
): (() => void) => {
  const pendingWrite = Symbol();
  pendingTerminalWritesRef.current.add(pendingWrite);
  let isFinished = false;

  return () => {
    if (isFinished) {
      return;
    }

    isFinished = true;
    pendingTerminalWritesRef.current.delete(pendingWrite);
  };
};

const writeTerminalOutput = (
  terminal: TerminalBinding["terminal"],
  data: string,
  waitForAcknowledgement: boolean,
  pendingTerminalWritesRef: PendingTerminalWritesRef,
): Promise<void> => {
  if (data.length === 0) {
    return Promise.resolve();
  }

  const finishPendingWrite = trackPendingTerminalWrite(pendingTerminalWritesRef);

  if (!waitForAcknowledgement) {
    try {
      terminal.write(data, finishPendingWrite);
    } catch (error) {
      finishPendingWrite();
      throw error;
    }
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const resolveWrite = (): void => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      resolve();
    };
    const finishAcknowledgedWrite = (): void => {
      finishPendingWrite();
      resolveWrite();
    };

    timeoutId = setTimeout(resolveWrite, TERMINAL_WRITE_ACK_TIMEOUT_MS);
    try {
      terminal.write(data, finishAcknowledgedWrite);
    } catch (error) {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
      finishPendingWrite();
      throw error;
    }
  });
};

const readTerminalErrorMessage = (action: "initialize" | "render", error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return `Failed to ${action} dev server terminal: ${message}`;
};

const isCopyKeyEvent = (event: KeyboardEvent): boolean => {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "c";
};

const wireTerminalSelectionCopy = (binding: TerminalBinding): void => {
  if (!binding.terminal.attachCustomKeyEventHandler) {
    return;
  }

  binding.terminal.attachCustomKeyEventHandler((event) => {
    if (!isCopyKeyEvent(event) || !binding.terminal.hasSelection?.()) {
      return true;
    }

    const selection = binding.terminal.getSelection?.() ?? "";
    if (selection.length === 0 || !navigator.clipboard?.writeText) {
      return true;
    }

    void navigator.clipboard.writeText(selection).catch((error) => {
      console.error("[AgentStudioDevServerTerminal] Clipboard write failed:", error);
    });
    return false;
  });
};

const resetRenderedTerminalState = (renderedStateRef: { current: RenderedTerminalState }): void => {
  renderedStateRef.current = {
    scriptId: null,
    resetToken: null,
    lastSequence: null,
  };
};

const resetTerminalRenderQueue = (
  renderedStateRef: { current: RenderedTerminalState },
  renderQueueRef: { current: Promise<void> | null },
  renderGenerationRef: { current: number },
): void => {
  resetRenderedTerminalState(renderedStateRef);
  renderGenerationRef.current += 1;
  renderQueueRef.current = Promise.resolve();
};

const createResizeObserverCleanup = (
  container: HTMLElement,
  binding: TerminalBinding,
): (() => void) => {
  if (typeof ResizeObserver === "undefined") {
    return () => {};
  }

  const resizeObserver = new ResizeObserver(() => {
    binding.fitAddon.fit();
  });
  resizeObserver.observe(container);
  return () => {
    resizeObserver.disconnect();
  };
};

const createThemeObserverCleanup = (
  container: HTMLElement,
  binding: TerminalBinding,
): (() => void) => {
  if (typeof MutationObserver === "undefined") {
    return () => {};
  }

  const themeObserver = new MutationObserver(() => {
    binding.terminal.options.theme = buildTerminalTheme(container);
    binding.fitAddon.fit();
  });
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style"],
  });
  return () => {
    themeObserver.disconnect();
  };
};

const createTerminalObserversCleanup = (
  container: HTMLElement,
  binding: TerminalBinding,
): (() => void) => {
  const cleanupResizeObserver = createResizeObserverCleanup(container, binding);
  const cleanupThemeObserver = createThemeObserverCleanup(container, binding);

  return () => {
    cleanupResizeObserver();
    cleanupThemeObserver();
  };
};

const disposeTerminalBinding = (
  bindingRef: { current: TerminalBinding | null },
  renderedStateRef: { current: RenderedTerminalState },
  renderQueueRef: { current: Promise<void> | null },
  renderGenerationRef: { current: number },
): void => {
  bindingRef.current?.terminal.dispose();
  bindingRef.current?.fitAddon.dispose();
  bindingRef.current = null;
  resetTerminalRenderQueue(renderedStateRef, renderQueueRef, renderGenerationRef);
};

const readTerminalReplayOutput = (
  entries: AgentStudioDevServerTerminalBuffer["entries"],
): string => {
  return entries.map((entry) => entry.data).join("");
};

const readAppendedTerminalOutput = (
  entries: AgentStudioDevServerTerminalBuffer["entries"],
  lastRenderedSequence: number | null,
): string => {
  let output = "";
  for (const entry of entries) {
    if (lastRenderedSequence === null || entry.sequence > lastRenderedSequence) {
      output += entry.data;
    }
  }
  return output;
};

const renderTerminalBuffer = async ({
  binding,
  scriptId,
  terminalBuffer,
  renderedStateRef,
  pendingTerminalWritesRef,
  recreateTerminalBinding,
}: {
  binding: TerminalBinding;
  scriptId: string;
  terminalBuffer: AgentStudioDevServerTerminalBuffer | null;
  renderedStateRef: { current: RenderedTerminalState };
  pendingTerminalWritesRef: PendingTerminalWritesRef;
  recreateTerminalBinding: () => TerminalBinding | null;
}): Promise<void> => {
  const entries = terminalBuffer?.entries ?? [];
  const nextResetToken = terminalBuffer?.resetToken ?? 0;
  const nextLastSequence = terminalBuffer?.lastSequence ?? null;
  const didScriptChange = renderedStateRef.current.scriptId !== scriptId;
  const didResetTokenChange = renderedStateRef.current.resetToken !== nextResetToken;

  if (didScriptChange || didResetTokenChange) {
    const activeBinding =
      pendingTerminalWritesRef.current.size > 0 ? recreateTerminalBinding() : binding;
    if (!activeBinding) {
      throw new Error("Cannot recreate dev server terminal before replay without a container");
    }

    activeBinding.terminal.reset();
    activeBinding.terminal.clear();
    await writeTerminalOutput(
      activeBinding.terminal,
      readTerminalReplayOutput(entries),
      true,
      pendingTerminalWritesRef,
    );
    activeBinding.fitAddon.fit();
    renderedStateRef.current = {
      scriptId,
      resetToken: nextResetToken,
      lastSequence: nextLastSequence,
    };
    return;
  }

  await writeTerminalOutput(
    binding.terminal,
    readAppendedTerminalOutput(entries, renderedStateRef.current.lastSequence),
    false,
    pendingTerminalWritesRef,
  );
  renderedStateRef.current.lastSequence = nextLastSequence;
};

export const useDevServerTerminalBinding = ({
  containerRef,
  createTerminalBinding,
  onRendererError,
}: UseDevServerTerminalBindingArgs): TerminalRenderController => {
  const bindingRef = useRef<TerminalBinding | null>(null);
  const renderedStateRef = useRef<RenderedTerminalState>({
    scriptId: null,
    resetToken: null,
    lastSequence: null,
  });
  const renderQueueRef = useRef<Promise<void> | null>(null);
  if (renderQueueRef.current === null) {
    renderQueueRef.current = Promise.resolve();
  }
  const renderGenerationRef = useRef(0);
  const pendingTerminalWritesRef = useRef<Set<symbol>>(new Set());
  const terminalObserversCleanupRef = useRef<(() => void) | null>(null);

  const recreateTerminalBinding = useCallback((): TerminalBinding | null => {
    const container = containerRef.current;
    if (!container) {
      return null;
    }

    terminalObserversCleanupRef.current?.();
    terminalObserversCleanupRef.current = null;
    bindingRef.current?.terminal.dispose();
    bindingRef.current?.fitAddon.dispose();
    bindingRef.current = null;
    pendingTerminalWritesRef.current = new Set();

    const binding = createTerminalBinding(container, terminalOptions(container));
    wireTerminalSelectionCopy(binding);
    bindingRef.current = binding;
    terminalObserversCleanupRef.current = createTerminalObserversCleanup(container, binding);
    return binding;
  }, [containerRef, createTerminalBinding]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    try {
      recreateTerminalBinding();
      onRendererError(null);

      return () => {
        terminalObserversCleanupRef.current?.();
        terminalObserversCleanupRef.current = null;
        pendingTerminalWritesRef.current = new Set();
        disposeTerminalBinding(bindingRef, renderedStateRef, renderQueueRef, renderGenerationRef);
      };
    } catch (error) {
      onRendererError(readTerminalErrorMessage("initialize", error));
    }
  }, [containerRef, onRendererError, recreateTerminalBinding]);

  return {
    bindingRef,
    renderedStateRef,
    renderQueueRef,
    renderGenerationRef,
    pendingTerminalWritesRef,
    recreateTerminalBinding,
  };
};

export const useDevServerTerminalRendering = ({
  bindingRef,
  renderedStateRef,
  renderQueueRef,
  renderGenerationRef,
  pendingTerminalWritesRef,
  recreateTerminalBinding,
  scriptId,
  terminalBuffer,
  onRendererError,
}: UseDevServerTerminalRenderingArgs): void => {
  useEffect(() => {
    const binding = bindingRef.current;
    if (!binding) {
      return;
    }

    const renderGeneration = renderGenerationRef.current + 1;
    renderGenerationRef.current = renderGeneration;

    renderQueueRef.current = (renderQueueRef.current ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const queuedBinding = bindingRef.current;
        if (!queuedBinding || renderGeneration !== renderGenerationRef.current) {
          return;
        }

        await renderTerminalBuffer({
          binding: queuedBinding,
          scriptId,
          terminalBuffer,
          renderedStateRef,
          pendingTerminalWritesRef,
          recreateTerminalBinding,
        });
        if (bindingRef.current && renderGeneration === renderGenerationRef.current) {
          onRendererError(null);
        }
      })
      .catch((error) => {
        if (renderGeneration === renderGenerationRef.current) {
          onRendererError(readTerminalErrorMessage("render", error));
        }
      });
  }, [
    bindingRef,
    onRendererError,
    renderGenerationRef,
    renderQueueRef,
    renderedStateRef,
    pendingTerminalWritesRef,
    recreateTerminalBinding,
    scriptId,
    terminalBuffer,
  ]);
};
