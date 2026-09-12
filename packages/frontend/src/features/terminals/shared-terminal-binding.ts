import { FitAddon } from "@xterm/addon-fit";
import { type ITerminalOptions, Terminal } from "@xterm/xterm";
import { toast } from "sonner";
import { errorMessage } from "@/lib/errors";
import { openExternalUrl } from "@/lib/open-external-url";
import {
  createTerminalLinkController,
  type TerminalLinkController,
} from "./terminal-link-controller";

type SharedTerminalDependencies = {
  openUrl?: (url: string) => Promise<void>;
  reportOpenError?: (url: string, cause: unknown) => void;
};

export type SharedTerminalBinding = {
  terminal: Terminal;
  fitAddon: FitAddon;
  linkController: TerminalLinkController;
  dispose(): void;
  resetLinkState(): void;
};

const reportTerminalLinkOpenError = (_url: string, cause: unknown): void => {
  toast.error("Failed to open terminal link", {
    description: `${errorMessage(cause)} Copy the URL into a browser.`,
  });
};

export const createSharedTerminalBinding = (
  container: HTMLElement,
  options: ITerminalOptions,
  dependencies: SharedTerminalDependencies = {},
): SharedTerminalBinding => {
  const linkController = createTerminalLinkController({
    container,
    openUrl: dependencies.openUrl ?? openExternalUrl,
    reportOpenError: dependencies.reportOpenError ?? reportTerminalLinkOpenError,
  });
  const { linkHandler: _ignoredLinkHandler, ...ownedOptions } = options;
  const terminal = new Terminal({ ...ownedOptions, linkHandler: linkController.linkHandler });
  const fitAddon = new FitAddon();
  let disposed = false;

  try {
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminal.loadAddon(linkController);
  } catch (cause) {
    terminal.dispose();
    fitAddon.dispose();
    linkController.dispose();
    throw cause;
  }

  return {
    terminal,
    fitAddon,
    linkController,
    resetLinkState: () => linkController.reset(),
    dispose: () => {
      if (disposed) return;
      disposed = true;
      terminal.dispose();
    },
  };
};
