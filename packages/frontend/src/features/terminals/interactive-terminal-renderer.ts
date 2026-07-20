import type { IDisposable, IEvent, ITerminalAddon } from "@xterm/xterm";

export type ContextAwareTerminalRenderer = ITerminalAddon & {
  readonly onContextLoss: IEvent<void>;
};

export const attachInteractiveTerminalRenderer = ({
  terminal,
  renderer,
  onContextLoss,
}: {
  terminal: { loadAddon: (addon: ITerminalAddon) => void };
  renderer: ContextAwareTerminalRenderer;
  onContextLoss: () => void;
}): IDisposable => {
  const contextLossSubscription = renderer.onContextLoss(() => {
    renderer.dispose();
    onContextLoss();
  });
  try {
    terminal.loadAddon(renderer);
  } catch (cause) {
    contextLossSubscription.dispose();
    throw cause;
  }
  return contextLossSubscription;
};

const captureTerminalRendererFrame = (container: HTMLElement): IDisposable | null => {
  const source = container.querySelector<HTMLCanvasElement>(
    ".xterm-screen canvas:not(.xterm-link-layer)",
  );
  const parent = source?.parentElement;
  if (!source || !parent || source.width === 0 || source.height === 0) return null;

  const overlay = document.createElement("canvas");
  overlay.width = source.width;
  overlay.height = source.height;
  overlay.style.position = "absolute";
  overlay.style.inset = "0";
  overlay.style.width = `${source.clientWidth}px`;
  overlay.style.height = `${source.clientHeight}px`;
  overlay.style.pointerEvents = "none";
  overlay.style.zIndex = "1";
  const context = overlay.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0);
  parent.append(overlay);
  return { dispose: () => overlay.remove() };
};

/**
 * Prevents the canvas-clear frame in addon-webgl 0.19 while keeping fits live.
 * Delete this buffer and disable preserveDrawingBuffer after a stable addon-webgl
 * release includes xtermjs/xterm.js#5529.
 */
export const createBufferedTerminalFitter = ({
  container,
  terminal,
  fitAddon,
}: {
  container: HTMLElement;
  terminal: {
    readonly cols: number;
    readonly rows: number;
    onRender: (listener: () => void) => IDisposable;
  };
  fitAddon: {
    fit: () => void;
    proposeDimensions: () => { cols: number; rows: number } | undefined;
  };
}) => {
  let bufferedFrame: IDisposable | null = null;
  let removalFrame: number | null = null;

  const removeBufferedFrame = (): void => {
    if (removalFrame !== null) {
      cancelAnimationFrame(removalFrame);
      removalFrame = null;
    }
    bufferedFrame?.dispose();
    bufferedFrame = null;
  };

  const renderSubscription = terminal.onRender(() => {
    if (!bufferedFrame || removalFrame !== null) return;
    removalFrame = requestAnimationFrame(() => {
      removalFrame = null;
      bufferedFrame?.dispose();
      bufferedFrame = null;
    });
  });

  return {
    fit(): void {
      const proposed = fitAddon.proposeDimensions();
      if (proposed && (proposed.cols !== terminal.cols || proposed.rows !== terminal.rows)) {
        removeBufferedFrame();
        bufferedFrame = captureTerminalRendererFrame(container);
      }
      fitAddon.fit();
    },
    dispose(): void {
      renderSubscription.dispose();
      removeBufferedFrame();
    },
  };
};
