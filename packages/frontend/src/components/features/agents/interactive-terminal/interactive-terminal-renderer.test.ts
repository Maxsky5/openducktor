import { describe, expect, mock, test } from "bun:test";
import type { IDisposable, IEvent, Terminal } from "@xterm/xterm";
import {
  attachInteractiveTerminalRenderer,
  type ContextAwareTerminalRenderer,
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
