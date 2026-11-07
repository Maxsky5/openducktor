import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { type ITerminalOptions, Terminal } from "@xterm/xterm";
import { toast } from "sonner";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import { openClickedLink } from "@/lib/link-open";
import { createLinkController } from "./terminal-link-controller";
import { createTerminalTheme } from "./terminal-xterm-options";

export type TerminalBinding = {
  terminal: Terminal;
  fitAddon: Pick<FitAddon, "fit" | "proposeDimensions">;
  /** Queues binary output in parser chunks while GPU rendering is active. */
  write(payload: Uint8Array, parsed: () => void): void;
  dispose(): void;
  resetLinkState(): void;
};

const WRITE_CHUNK_BYTES = 16 * 1024;

const createTerminalRenderer = (terminal: Terminal, reportFailure: (cause: Error) => void) => {
  let addon: WebglAddon | undefined;
  let canvas: HTMLCanvasElement | null = null;
  let subscription: { dispose(): void } | undefined;
  let releaseContext: WEBGL_lose_context | null = null;
  let disposed = false;
  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    subscription?.dispose();
    try {
      addon?.dispose();
    } finally {
      // addon-webgl 0.19 removes its canvas without releasing its context (xterm.js #6068).
      releaseContext?.loseContext();
    }
  };
  try {
    addon = new WebglAddon();
    try {
      terminal.loadAddon(addon);
    } finally {
      // addon-webgl 0.19 appends this canvas before shader setup can fail.
      canvas =
        terminal.element?.querySelector<HTMLCanvasElement>(".xterm-screen > canvas:last-of-type") ??
        null;
      releaseContext = canvas?.getContext("webgl2")?.getExtension("WEBGL_lose_context") ?? null;
    }
    if (!releaseContext)
      throw new Error("The terminal renderer cannot release its WebGL2 context.");
    subscription = addon.onContextLoss(() => {
      dispose();
      reportFailure(
        new Error(
          "Terminal graphics acceleration stopped. Output remains available with the standard renderer. Restart OpenDucktor to restore graphics acceleration.",
        ),
      );
    });
  } catch (cause) {
    dispose();
    canvas?.remove();
    throw cause;
  }
  return dispose;
};

const reportOpenError = (_url: string, cause: unknown): void => {
  toast.error("Failed to open terminal link", {
    description: `${errorMessage(cause)} Copy the URL into a browser.`,
  });
};

const createTerminalResources = (container: HTMLElement, options: ITerminalOptions) => {
  const links = createLinkController({
    container,
    openUrl: (url, click) =>
      openClickedLink(url, click, { x: click.clientX, y: click.clientY, width: 0, height: 0 }),
    reportOpenError,
  });
  const terminal = new Terminal({ ...options, linkHandler: links.linkHandler });
  const fitAddon = new FitAddon();
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
  return { terminal, fitAddon, links };
};

export const createTerminalBinding = (
  container: HTMLElement,
  options: ITerminalOptions,
  reportRendererFailure: (cause: Error) => void,
): TerminalBinding => {
  let resources = createTerminalResources(container, options);
  let disposeRenderer: (() => void) | undefined;
  let webglActive = false;
  let disposed = false;
  const themeObserver = new MutationObserver(() => {
    if (!disposed) resources.terminal.options.theme = createTerminalTheme(container);
  });
  try {
    try {
      disposeRenderer = createTerminalRenderer(resources.terminal, (cause) => {
        webglActive = false;
        reportRendererFailure(cause);
      });
      webglActive = true;
    } catch (cause) {
      // Failed GPU initialization can leave listeners in this emulator's services.
      // No output has entered the binding yet, so replace it with a clean standard terminal.
      resources.terminal.dispose();
      resources = createTerminalResources(container, options);
      reportRendererFailure(
        new Error(
          `Terminal graphics acceleration is unavailable: ${errorMessage(cause)} Output remains available with the standard renderer. Check graphics acceleration in your browser or restart OpenDucktor.`,
          { cause },
        ),
      );
    }
    themeObserver.observe(container.ownerDocument.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
  } catch (cause) {
    themeObserver.disconnect();
    disposeRenderer?.();
    resources.terminal.dispose();
    throw cause;
  }
  const { terminal, fitAddon, links } = resources;

  return {
    terminal,
    write: (payload, parsed) => {
      // Splitting standard-renderer writes would draw expensive intermediate restore screens.
      if (!webglActive || payload.byteLength <= WRITE_CHUNK_BYTES) {
        terminal.write(payload, parsed);
        return;
      }
      // xterm yields between queued writes, but it parses each write in one uninterrupted call.
      for (let offset = 0; offset < payload.byteLength; offset += WRITE_CHUNK_BYTES) {
        const end = Math.min(offset + WRITE_CHUNK_BYTES, payload.byteLength);
        terminal.write(
          payload.subarray(offset, end),
          end === payload.byteLength ? parsed : undefined,
        );
      }
    },
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
      disposeRenderer?.();
      terminal.dispose();
    },
  };
};
