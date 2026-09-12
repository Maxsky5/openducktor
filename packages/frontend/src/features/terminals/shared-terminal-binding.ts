import { FitAddon } from "@xterm/addon-fit";
import { type ITerminalOptions, Terminal } from "@xterm/xterm";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import { createLinkController } from "./terminal-link-controller";

type BindingDeps = {
  openUrl?: (url: string) => Promise<void>;
  reportOpenError?: (url: string, cause: unknown) => void;
};

export type TerminalBinding = {
  terminal: Terminal;
  fitAddon: FitAddon;
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
  deps: BindingDeps = {},
): TerminalBinding => {
  const links = createLinkController({
    container,
    openUrl: deps.openUrl ?? openExternalUrl,
    reportOpenError: deps.reportOpenError ?? reportOpenError,
  });
  const terminal = new Terminal({ ...options, linkHandler: links.linkHandler });
  const fitAddon = new FitAddon();
  let disposed = false;

  try {
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.loadAddon(links);
  } catch (cause) {
    terminal.dispose();
    fitAddon.dispose();
    links.dispose();
    throw cause;
  }

  return {
    terminal,
    fitAddon,
    resetLinkState: () => links.reset(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      terminal.dispose();
    },
  };
};
