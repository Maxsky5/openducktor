import { afterEach, describe, expect, mock, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { IDisposable, IEvent, Terminal } from "@xterm/xterm";
import {
  attachInteractiveTerminalRenderer,
  type ContextAwareTerminalRenderer,
  createActiveTerminalRenderer,
  createBufferedTerminalFitter,
} from "./interactive-terminal-renderer";

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

afterEach(() => {
  document.body.innerHTML = "";
});

const createContextLossEvent = (): {
  event: IEvent<void>;
  fire: () => void;
  dispose: ReturnType<typeof mock>;
} => {
  let listener: (() => void) | null = null;
  const dispose = mock(() => {
    listener = null;
  });
  return {
    event: (registeredListener) => {
      listener = registeredListener;
      return { dispose } satisfies IDisposable;
    },
    fire: () => listener?.(),
    dispose,
  };
};

describe("attachInteractiveTerminalRenderer", () => {
  test("loads the renderer and reports context loss after disposing it", () => {
    const contextLoss = createContextLossEvent();
    const disposeRenderer = mock(() => undefined);
    const renderer: ContextAwareTerminalRenderer = {
      activate: (_terminal: Terminal) => undefined,
      dispose: disposeRenderer,
      onContextLoss: contextLoss.event,
    };
    const loadAddon = mock(() => undefined);
    const onContextLoss = mock(() => undefined);

    const subscription = attachInteractiveTerminalRenderer({
      terminal: { loadAddon },
      renderer,
      onContextLoss,
    });

    expect(loadAddon).toHaveBeenCalledWith(renderer);
    contextLoss.fire();
    expect(disposeRenderer).toHaveBeenCalledTimes(1);
    expect(onContextLoss).toHaveBeenCalledTimes(1);

    subscription.dispose();
    expect(contextLoss.dispose).toHaveBeenCalledTimes(1);
  });

  test("releases the context listener when the renderer cannot be loaded", () => {
    const contextLoss = createContextLossEvent();
    const renderer: ContextAwareTerminalRenderer = {
      activate: (_terminal: Terminal) => undefined,
      dispose: () => undefined,
      onContextLoss: contextLoss.event,
    };
    const failure = new Error("WebGL unavailable");

    expect(() =>
      attachInteractiveTerminalRenderer({
        terminal: {
          loadAddon: () => {
            throw failure;
          },
        },
        renderer,
        onContextLoss: () => undefined,
      }),
    ).toThrow(failure);
    expect(contextLoss.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("createActiveTerminalRenderer", () => {
  test("keeps one WebGL renderer only while its terminal is active", () => {
    const renderers: Array<{
      contextLoss: ReturnType<typeof createContextLossEvent>;
      dispose: ReturnType<typeof mock>;
      renderer: ContextAwareTerminalRenderer;
    }> = [];
    const loadAddon = mock(() => undefined);
    const activeRenderer = createActiveTerminalRenderer({
      terminal: { loadAddon },
      createRenderer: () => {
        const contextLoss = createContextLossEvent();
        const dispose = mock(() => undefined);
        const renderer: ContextAwareTerminalRenderer = {
          activate: (_terminal: Terminal) => undefined,
          dispose,
          onContextLoss: contextLoss.event,
        };
        renderers.push({ contextLoss, dispose, renderer });
        return renderer;
      },
      onContextLoss: () => undefined,
    });

    activeRenderer.setActive(false);
    expect(renderers).toHaveLength(0);

    activeRenderer.setActive(true);
    activeRenderer.setActive(true);
    expect(renderers).toHaveLength(1);
    expect(loadAddon).toHaveBeenCalledTimes(1);

    activeRenderer.setActive(false);
    expect(renderers[0]?.contextLoss.dispose).toHaveBeenCalledTimes(1);
    expect(renderers[0]?.dispose).toHaveBeenCalledTimes(1);

    activeRenderer.setActive(true);
    expect(renderers).toHaveLength(2);
    expect(loadAddon).toHaveBeenCalledTimes(2);

    activeRenderer.dispose();
    expect(renderers[1]?.contextLoss.dispose).toHaveBeenCalledTimes(1);
    expect(renderers[1]?.dispose).toHaveBeenCalledTimes(1);
  });

  test("disposes a renderer that fails to load", () => {
    const contextLoss = createContextLossEvent();
    const dispose = mock(() => undefined);
    const renderer: ContextAwareTerminalRenderer = {
      activate: (_terminal: Terminal) => undefined,
      dispose,
      onContextLoss: contextLoss.event,
    };
    const failure = new Error("WebGL unavailable");
    const activeRenderer = createActiveTerminalRenderer({
      terminal: {
        loadAddon: () => {
          throw failure;
        },
      },
      createRenderer: () => renderer,
      onContextLoss: () => undefined,
    });

    expect(() => activeRenderer.setActive(true)).toThrow(failure);
    expect(contextLoss.dispose).toHaveBeenCalledTimes(1);
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});

const createTerminalCanvas = () => {
  const container = document.createElement("div");
  const screen = document.createElement("div");
  screen.className = "xterm-screen";
  const linkCanvas = document.createElement("canvas");
  linkCanvas.className = "xterm-link-layer";
  const rendererCanvas = document.createElement("canvas");
  rendererCanvas.width = 1280;
  rendererCanvas.height = 800;
  Object.defineProperties(rendererCanvas, {
    clientWidth: { value: 640 },
    clientHeight: { value: 400 },
  });
  screen.append(linkCanvas, rendererCanvas);
  container.append(screen);
  document.body.append(container);
  return { container, screen, rendererCanvas };
};

const withCanvasContext = async (
  run: (drawImage: ReturnType<typeof mock>) => Promise<void> | void,
): Promise<void> => {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "getContext");
  const drawImage = mock(() => undefined);
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => ({ drawImage }),
  });
  try {
    await run(drawImage);
  } finally {
    if (descriptor) {
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", descriptor);
    } else {
      Reflect.deleteProperty(HTMLCanvasElement.prototype, "getContext");
    }
  }
};

describe("createBufferedTerminalFitter", () => {
  test("buffers only grid-changing fits until xterm renders", async () => {
    await withCanvasContext(async (drawImage) => {
      const { container, screen, rendererCanvas } = createTerminalCanvas();
      const render = createContextLossEvent();
      let proposed = { cols: 80, rows: 24 };
      const fit = mock(() => undefined);
      const fitter = createBufferedTerminalFitter({
        container,
        terminal: { cols: 80, rows: 24, onRender: render.event },
        fitAddon: { fit, proposeDimensions: () => proposed },
      });

      fitter.fit();
      expect(fit).toHaveBeenCalledTimes(1);
      expect(drawImage).not.toHaveBeenCalled();

      proposed = { cols: 100, rows: 30 };
      fitter.fit();
      expect(fit).toHaveBeenCalledTimes(2);
      expect(drawImage).toHaveBeenCalledWith(rendererCanvas, 0, 0);
      expect(screen.querySelectorAll("canvas")).toHaveLength(3);

      render.fire();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      expect(screen.querySelectorAll("canvas")).toHaveLength(2);

      fitter.dispose();
      expect(render.dispose).toHaveBeenCalledTimes(1);
    });
  });

  test("replaces a stale frame and cancels its pending removal", async () => {
    await withCanvasContext(async () => {
      const { container, screen } = createTerminalCanvas();
      const render = createContextLossEvent();
      const fitter = createBufferedTerminalFitter({
        container,
        terminal: { cols: 80, rows: 24, onRender: render.event },
        fitAddon: {
          fit: () => undefined,
          proposeDimensions: () => ({ cols: 100, rows: 30 }),
        },
      });

      fitter.fit();
      render.fire();
      fitter.fit();
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

      expect(screen.querySelectorAll("canvas")).toHaveLength(3);
      fitter.dispose();
      expect(screen.querySelectorAll("canvas")).toHaveLength(2);
      expect(render.dispose).toHaveBeenCalledTimes(1);
    });
  });
});
