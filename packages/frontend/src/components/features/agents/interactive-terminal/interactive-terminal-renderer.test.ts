import { describe, expect, mock, test } from "bun:test";
import type { IDisposable, IEvent, Terminal } from "@xterm/xterm";
import {
  attachInteractiveTerminalRenderer,
  type ContextAwareTerminalRenderer,
  createTerminalResizeFrameBuffer,
} from "./interactive-terminal-renderer";

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

describe("createTerminalResizeFrameBuffer", () => {
  test("keeps the captured frame until xterm renders the resized grid", () => {
    const render = createContextLossEvent();
    const disposeFrame = mock(() => undefined);
    const scheduledFrames = new Map<number, FrameRequestCallback>();
    const buffer = createTerminalResizeFrameBuffer({
      captureFrame: () => ({ dispose: disposeFrame }),
      onRender: render.event,
      requestFrame: (callback) => {
        scheduledFrames.set(1, callback);
        return 1;
      },
      cancelFrame: (frameId) => {
        scheduledFrames.delete(frameId);
      },
    });

    buffer.preserveCurrentFrame();
    expect(disposeFrame).not.toHaveBeenCalled();

    render.fire();
    expect(scheduledFrames.size).toBe(1);
    scheduledFrames.get(1)?.(0);
    expect(disposeFrame).toHaveBeenCalledTimes(1);

    buffer.dispose();
    expect(render.dispose).toHaveBeenCalledTimes(1);
  });

  test("replaces a stale frame and cancels its pending removal", () => {
    const render = createContextLossEvent();
    const firstFrame = { dispose: mock(() => undefined) };
    const secondFrame = { dispose: mock(() => undefined) };
    const frames = [firstFrame, secondFrame];
    const cancelledFrames: number[] = [];
    const buffer = createTerminalResizeFrameBuffer({
      captureFrame: () => frames.shift() ?? null,
      onRender: render.event,
      requestFrame: () => 7,
      cancelFrame: (frameId) => cancelledFrames.push(frameId),
    });

    buffer.preserveCurrentFrame();
    render.fire();
    buffer.preserveCurrentFrame();

    expect(cancelledFrames).toEqual([7]);
    expect(firstFrame.dispose).toHaveBeenCalledTimes(1);
    expect(secondFrame.dispose).not.toHaveBeenCalled();

    buffer.dispose();
    expect(secondFrame.dispose).toHaveBeenCalledTimes(1);
  });
});
