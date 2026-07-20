import { FitAddon } from "@xterm/addon-fit";
import { type ITerminalOptions, Terminal } from "@xterm/xterm";
import { useCallback, useEffect, useRef } from "react";
import type { AgentStudioDevServerTerminalBuffer } from "@/features/agent-studio-build-tools/dev-server-log-buffer";
import {
  createTerminalOptions,
  createTerminalTheme,
} from "@/features/terminals/terminal-xterm-options";

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
  terminalIdentityKey: string | null;
  resetToken: number | null;
  lastSequence: number | null;
};

type TerminalRenderController = {
  bindingRef: { current: TerminalBinding | null };
  renderedStateRef: { current: RenderedTerminalState };
  renderQueueRef: { current: Promise<void> | null };
  renderGenerationRef: { current: number };
  recreateTerminalBinding: () => TerminalBinding | null;
};

type UseDevServerTerminalBindingArgs = {
  containerRef: { current: HTMLDivElement | null };
  createTerminalBinding: CreateTerminalBinding;
  onRendererError: (message: string | null) => void;
};

type UseDevServerTerminalRenderingArgs = TerminalRenderController & {
  terminalIdentityKey: string;
  terminalBuffer: AgentStudioDevServerTerminalBuffer | null;
  onRendererError: (message: string | null) => void;
};

export const defaultCreateTerminalBinding: CreateTerminalBinding = (container, options) => {
  const terminal = new Terminal(options);
  const fitAddon = new FitAddon();
  terminal.loadAddon(fitAddon);
  terminal.open(container);
  fitAddon.fit();
  return { terminal, fitAddon };
};

const terminalOptions = (container: HTMLElement): ITerminalOptions =>
  createTerminalOptions(container, {
    cursorBlink: false,
    disableStdin: true,
  });

const writeTerminalOutput = (terminal: TerminalBinding["terminal"], data: string): void => {
  if (data.length === 0) {
    return;
  }

  terminal.write(data);
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
    terminalIdentityKey: null,
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
    binding.terminal.options.theme = createTerminalTheme(container);
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

const renderTerminalBuffer = ({
  binding,
  terminalIdentityKey,
  terminalBuffer,
  renderedStateRef,
  recreateTerminalBinding,
}: {
  binding: TerminalBinding;
  terminalIdentityKey: string;
  terminalBuffer: AgentStudioDevServerTerminalBuffer | null;
  renderedStateRef: { current: RenderedTerminalState };
  recreateTerminalBinding: () => TerminalBinding | null;
}): void => {
  const entries = terminalBuffer?.entries ?? [];
  const nextResetToken = terminalBuffer?.resetToken ?? 0;
  const nextLastSequence = terminalBuffer?.lastSequence ?? null;
  const didTerminalIdentityChange =
    renderedStateRef.current.terminalIdentityKey !== terminalIdentityKey;
  const didResetTokenChange = renderedStateRef.current.resetToken !== nextResetToken;

  if (didTerminalIdentityChange || didResetTokenChange) {
    const hasRenderedCurrentBinding = renderedStateRef.current.terminalIdentityKey !== null;
    const activeBinding = hasRenderedCurrentBinding ? recreateTerminalBinding() : binding;
    if (!activeBinding) {
      throw new Error("Cannot recreate dev server terminal before replay without a container");
    }

    activeBinding.terminal.reset();
    activeBinding.terminal.clear();
    writeTerminalOutput(activeBinding.terminal, readTerminalReplayOutput(entries));
    activeBinding.fitAddon.fit();
    renderedStateRef.current = {
      terminalIdentityKey,
      resetToken: nextResetToken,
      lastSequence: nextLastSequence,
    };
    return;
  }

  writeTerminalOutput(
    binding.terminal,
    readAppendedTerminalOutput(entries, renderedStateRef.current.lastSequence),
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
    terminalIdentityKey: null,
    resetToken: null,
    lastSequence: null,
  });
  const renderQueueRef = useRef<Promise<void> | null>(null);
  if (renderQueueRef.current === null) {
    renderQueueRef.current = Promise.resolve();
  }
  const renderGenerationRef = useRef(0);
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
    recreateTerminalBinding,
  };
};

export const useDevServerTerminalRendering = ({
  bindingRef,
  renderedStateRef,
  renderQueueRef,
  renderGenerationRef,
  recreateTerminalBinding,
  terminalIdentityKey,
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
      .then(() => {
        const queuedBinding = bindingRef.current;
        if (!queuedBinding || renderGeneration !== renderGenerationRef.current) {
          return;
        }

        renderTerminalBuffer({
          binding: queuedBinding,
          terminalIdentityKey,
          terminalBuffer,
          renderedStateRef,
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
    recreateTerminalBinding,
    terminalIdentityKey,
    terminalBuffer,
  ]);
};
