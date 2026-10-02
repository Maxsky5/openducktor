import { FitAddon } from "@xterm/addon-fit";
import { type ITerminalOptions, Terminal } from "@xterm/xterm";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { createLinkController } from "./terminal-link-controller";
import { createTerminalTheme } from "./terminal-xterm-options";

export type TerminalBinding = {
  terminal: Terminal;
  fitAddon: Pick<FitAddon, "fit" | "proposeDimensions">;
  dispose(): void;
  resetLinkState(): void;
};

const reportOpenError = (_url: string, cause: unknown): void => {
  toast.error("Failed to open terminal link", {
    description: `${errorMessage(cause)} Copy the URL into a browser.`,
  });
};

export const createTerminalBinding = (
  container: HTMLElement,
  options: ITerminalOptions,
): TerminalBinding => {
  const links = createLinkController({
    container,
    openUrl: openExternalUrl,
    reportOpenError,
  });
  const terminal = new Terminal({ ...options, linkHandler: links.linkHandler });
  const fitAddon = new FitAddon();
  let disposed = false;
  const themeObserver = new MutationObserver(() => {
    if (!disposed) terminal.options.theme = createTerminalTheme(container);
  });

  try {
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.loadAddon(links);
    themeObserver.observe(container.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  } catch (cause) {
    themeObserver.disconnect();
    terminal.dispose();
    fitAddon.dispose();
    links.dispose();
    throw cause;
  }

  return {
    terminal,
    fitAddon: {
      proposeDimensions: () => fitAddon.proposeDimensions(),
      fit: () => {
        if (disposed || container.clientWidth <= 0 || container.clientHeight <= 0) return;
        const dimensions = fitAddon.proposeDimensions();
        if (!dimensions || dimensions.cols <= 2 || dimensions.rows <= 1) return;
        if (!Number.isFinite(dimensions.cols) || !Number.isFinite(dimensions.rows)) return;
        if (terminal.cols === dimensions.cols && terminal.rows === dimensions.rows) return;
        // Terminal.resize owns reflow and rendering. FitAddon.fit also clears the renderer.
        terminal.resize(dimensions.cols, dimensions.rows);
      },
    },
    resetLinkState: () => links.reset(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      themeObserver.disconnect();
      terminal.dispose();
    },
  };
};
