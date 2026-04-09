import { FitAddon } from "@xterm/addon-fit";
import { type ITerminalOptions, type ITheme, Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { memo, type ReactElement, useEffect, useRef } from "react";
import type { AgentStudioDevServerTerminalBuffer } from "@/features/agent-studio-build-tools/dev-server-log-buffer";

type TerminalBinding = {
  terminal: Pick<Terminal, "dispose" | "loadAddon" | "open" | "options" | "reset" | "write">;
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

    if (didScriptChange || didResetTokenChange) {
      binding.terminal.reset();
      for (const entry of entries) {
        binding.terminal.write(entry.data);
      }
      binding.fitAddon.fit();
      renderedScriptIdRef.current = scriptId;
      renderedResetTokenRef.current = nextResetToken;
      renderedLastSequenceRef.current = terminalBuffer?.lastSequence ?? null;
      return;
    }

    const lastRenderedSequence = renderedLastSequenceRef.current;
    const appendedEntries = entries.filter(
      (entry) => lastRenderedSequence === null || entry.sequence > lastRenderedSequence,
    );
    for (const entry of appendedEntries) {
      binding.terminal.write(entry.data);
    }
    renderedLastSequenceRef.current = terminalBuffer?.lastSequence ?? null;
  }, [scriptId, terminalBuffer]);

  return (
    <div
      ref={containerRef}
      className="h-full min-h-0 w-full"
      data-testid="agent-studio-dev-server-terminal"
    />
  );
});
