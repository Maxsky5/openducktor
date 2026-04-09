import { FitAddon } from "@xterm/addon-fit";
import { type ITerminalOptions, type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { memo, type ReactElement, useEffect, useRef } from "react";
import type { AgentStudioDevServerTerminalBuffer } from "@/features/agent-studio-build-tools/dev-server-log-buffer";

type TerminalBinding = {
  terminal: Pick<Terminal, "dispose" | "loadAddon" | "open" | "options" | "reset"> & {
    write(data: string, callback?: () => void): void;
  };
  fitAddon: Pick<FitAddon, "dispose" | "fit">;
};

type CreateTerminalBinding = (container: HTMLElement, options: ITerminalOptions) => TerminalBinding;

type AgentStudioDevServerTerminalProps = {
  scriptId: string;
  terminalBuffer: AgentStudioDevServerTerminalBuffer | null;
  onRendererError: (message: string | null) => void;
  createTerminalBinding?: CreateTerminalBinding;
};

const readCssVariable = (element: HTMLElement, name: string): string => {
  return getComputedStyle(element).getPropertyValue(name).trim();
};

const buildTerminalTheme = (container: HTMLElement): ITheme => ({
  background: readCssVariable(container, "--dev-server-terminal-panel"),
  foreground: readCssVariable(container, "--dev-server-terminal-foreground"),
  cursor: readCssVariable(container, "--dev-server-terminal-foreground"),
  cursorAccent: readCssVariable(container, "--dev-server-terminal-panel"),
  selectionBackground: readCssVariable(container, "--dev-server-terminal-tab-active"),
  selectionInactiveBackground: readCssVariable(container, "--dev-server-terminal-chrome"),
});

const defaultCreateTerminalBinding: CreateTerminalBinding = (container, options) => {
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

const writeTerminalOutput = (
  terminal: TerminalBinding["terminal"],
  data: string,
): Promise<void> => {
  if (data.length === 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    terminal.write(data, resolve);
  });
};

export const AgentStudioDevServerTerminal = memo(function AgentStudioDevServerTerminal({
  scriptId,
  terminalBuffer,
  onRendererError,
  createTerminalBinding = defaultCreateTerminalBinding,
}: AgentStudioDevServerTerminalProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const bindingRef = useRef<TerminalBinding | null>(null);
  const renderedScriptIdRef = useRef<string | null>(null);
  const renderedResetTokenRef = useRef<number | null>(null);
  const renderedLastSequenceRef = useRef<number | null>(null);
  const renderQueueRef = useRef<Promise<void>>(Promise.resolve());
  const renderGenerationRef = useRef(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let resizeObserver: ResizeObserver | null = null;
    let themeObserver: MutationObserver | null = null;

    try {
      const binding = createTerminalBinding(container, terminalOptions(container));
      bindingRef.current = binding;
      onRendererError(null);

      if (typeof ResizeObserver !== "undefined") {
        resizeObserver = new ResizeObserver(() => {
          binding.fitAddon.fit();
        });
        resizeObserver.observe(container);
      }

      if (typeof MutationObserver !== "undefined") {
        themeObserver = new MutationObserver(() => {
          binding.terminal.options.theme = buildTerminalTheme(container);
          binding.fitAddon.fit();
        });
        themeObserver.observe(document.documentElement, {
          attributes: true,
          attributeFilter: ["class", "style"],
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      onRendererError(`Failed to initialize dev server terminal: ${message}`);
    }

    return () => {
      resizeObserver?.disconnect();
      themeObserver?.disconnect();
      bindingRef.current?.terminal.dispose();
      bindingRef.current?.fitAddon.dispose();
      bindingRef.current = null;
      renderedScriptIdRef.current = null;
      renderedResetTokenRef.current = null;
      renderedLastSequenceRef.current = null;
      renderGenerationRef.current += 1;
      renderQueueRef.current = Promise.resolve();
    };
  }, [createTerminalBinding, onRendererError]);

  useEffect(() => {
    const binding = bindingRef.current;
    if (!binding) {
      return;
    }

    const entries = terminalBuffer?.entries ?? [];
    const nextResetToken = terminalBuffer?.resetToken ?? 0;
    const didScriptChange = renderedScriptIdRef.current !== scriptId;
    const didResetTokenChange = renderedResetTokenRef.current !== nextResetToken;
    const renderGeneration = renderGenerationRef.current + 1;
    renderGenerationRef.current = renderGeneration;
    const nextRenderedLastSequence = terminalBuffer?.lastSequence ?? null;

    renderQueueRef.current = renderQueueRef.current
      .catch(() => {})
      .then(async () => {
        const queuedBinding = bindingRef.current;
        if (!queuedBinding || renderGeneration !== renderGenerationRef.current) {
          return;
        }

        if (didScriptChange || didResetTokenChange) {
          queuedBinding.terminal.reset();
          await writeTerminalOutput(
            queuedBinding.terminal,
            entries.map((entry) => entry.data).join(""),
          );
          if (!bindingRef.current || renderGeneration !== renderGenerationRef.current) {
            return;
          }

          queuedBinding.fitAddon.fit();
          renderedScriptIdRef.current = scriptId;
          renderedResetTokenRef.current = nextResetToken;
          renderedLastSequenceRef.current = nextRenderedLastSequence;
          return;
        }

        const lastRenderedSequence = renderedLastSequenceRef.current;
        const appendedOutput = entries
          .filter((entry) => lastRenderedSequence === null || entry.sequence > lastRenderedSequence)
          .map((entry) => entry.data)
          .join("");
        await writeTerminalOutput(queuedBinding.terminal, appendedOutput);
        if (!bindingRef.current || renderGeneration !== renderGenerationRef.current) {
          return;
        }

        renderedLastSequenceRef.current = nextRenderedLastSequence;
      });
  }, [scriptId, terminalBuffer]);

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0 w-full"
      data-testid="agent-studio-dev-server-terminal"
    />
  );
});
