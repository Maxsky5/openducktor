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

export const createTerminalResizeFrameBuffer = ({
  captureFrame,
  onRender,
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (frameId) => cancelAnimationFrame(frameId),
}: {
  captureFrame: () => IDisposable | null;
  onRender: (listener: () => void) => IDisposable;
  requestFrame?: (callback: FrameRequestCallback) => number;
  cancelFrame?: (frameId: number) => void;
}) => {
  let frame: IDisposable | null = null;
  let removalFrame: number | null = null;

  const removeFrame = (): void => {
    if (removalFrame !== null) {
      cancelFrame(removalFrame);
      removalFrame = null;
    }
    frame?.dispose();
    frame = null;
  };

  const renderSubscription = onRender(() => {
    if (!frame || removalFrame !== null) return;
    removalFrame = requestFrame(() => {
      removalFrame = null;
      frame?.dispose();
      frame = null;
    });
  });

  return {
    preserveCurrentFrame(): void {
      removeFrame();
      frame = captureFrame();
    },
    dispose(): void {
      renderSubscription.dispose();
      removeFrame();
    },
  };
};

// addon-webgl 0.19 clears its canvas before its deferred resize render (xterm.js#4922).
// Keep the last complete frame visible until xterm reports the replacement render.
export const captureTerminalRendererFrame = (container: HTMLElement): IDisposable | null => {
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
