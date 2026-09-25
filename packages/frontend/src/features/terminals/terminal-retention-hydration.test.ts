import { describe, expect, mock, spyOn, test } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { TERMINAL_PROTOCOL_VERSION, type TerminalServerMessage } from "@openducktor/contracts";
import {
  type InteractiveTerminalMount,
  mountInteractiveTerminal,
} from "./interactive-terminal-mount";
import * as sharedTerminalBinding from "./shared-terminal-binding";
import type { TerminalBinding } from "./shared-terminal-binding";
import type {
  TerminalFrameListener,
  TerminalTransportController,
} from "./terminal-transport-controller";

if (globalThis.document === undefined) {
  GlobalRegistrator.register();
}

// packages/host terminal limits: 32 live sessions + 64 retained exited sessions.
const PRODUCTION_TERMINAL_MOUNT_COUNT = 96;
const STALE_BUFFER_LINES = 4;

const nextFrame = (): Promise<void> =>
  new Promise((resolve) => requestAnimationFrame(() => resolve()));

const createController = () => {
  const listeners = new Map<string, TerminalFrameListener>();
  const controller: TerminalTransportController = {
    acknowledge: async () => undefined,
    closeTerminal: async <Result extends { closed: boolean }>(
      _terminalId: string,
      closeHostTerminal: () => Promise<Result>,
    ) => closeHostTerminal(),
    connect: async () => undefined,
    dispose: async () => undefined,
    releaseEmulator: () => undefined,
    resize: async () => undefined,
    subscribe: (terminalId: string, listener: TerminalFrameListener) => {
      listeners.set(terminalId, listener);
      return () => {
        listeners.delete(terminalId);
      };
    },
    write: async () => undefined,
  };
  return { controller, listeners };
};

const sendStaleBuffer = (listener: TerminalFrameListener, terminalId: string): void => {
  const payload = new TextEncoder().encode(
    `${terminalId} stale log\r\n`.repeat(STALE_BUFFER_LINES),
  );
  const snapshot: TerminalServerMessage = {
    version: TERMINAL_PROTOCOL_VERSION,
    type: "snapshot",
    terminalId,
    earliestRetainedSequence: 0,
    snapshotSequenceEnd: payload.byteLength,
    lifecycle: "running",
    title: terminalId,
    complete: true,
  };
  listener(snapshot, new Uint8Array());
  listener(
    {
      version: TERMINAL_PROTOCOL_VERSION,
      type: "output",
      terminalId,
      sequenceStart: 0,
      sequenceEnd: payload.byteLength,
      replay: true,
    },
    payload,
  );
};

const createLightweightBinding = () => {
  let output = "";
  let inputListener: (data: string) => void = () => undefined;
  let resizeListener: (grid: { cols: number; rows: number }) => void = () => undefined;
  const parsedCallbacks: Array<() => void> = [];
  const subscription = { dispose: mock(() => undefined) };
  const terminal = {
    cols: 80,
    rows: 24,
    _core: { _inputHandler: { _parser: { precedingJoinState: 0 } } },
    write: mock((payload: Uint8Array, parsed: () => void) => {
      output += new TextDecoder().decode(payload);
      parsedCallbacks.push(parsed);
    }),
    onResize: (listener: typeof resizeListener) => {
      resizeListener = listener;
      return subscription;
    },
    onData: (listener: typeof inputListener) => {
      inputListener = listener;
      return subscription;
    },
    reset: mock(() => {
      output = "";
    }),
    resize: mock((cols: number, rows: number) => {
      terminal.cols = cols;
      terminal.rows = rows;
      resizeListener({ cols, rows });
    }),
    parser: { registerOscHandler: () => subscription },
    attachCustomKeyEventHandler: () => undefined,
    scrollToBottom: mock(() => undefined),
    refresh: mock(() => undefined),
    focus: mock(() => undefined),
  };
  const binding = {
    terminal,
    fitAddon: { fit: mock(() => undefined) },
    resetLinkState: mock(() => undefined),
    dispose: mock(() => undefined),
  };
  return {
    binding,
    parsedCallbacks,
    readOutput: () => output,
    sendInput: (data: string) => inputListener(data),
  };
};

describe("retained terminal rendering", () => {
  test("holds input during restore and refits the live viewport after parsing", async () => {
    const lightweight = createLightweightBinding();
    const fit = lightweight.binding.fitAddon.fit;
    fit.mockImplementation(() => {
      lightweight.binding.terminal.resize(120, 40);
    });
    const createBinding = spyOn(sharedTerminalBinding, "createTerminalBinding").mockImplementation(
      // SAFETY: the fake terminal implements each method used by this mount test.
      () => Object.assign(Object.create(null), lightweight.binding) as TerminalBinding,
    );
    const { controller, listeners } = createController();
    const operations: string[] = [];
    controller.resize = async (_terminalId, columns, rows) => {
      operations.push(`resize:${columns}x${rows}`);
    };
    controller.write = async (_terminalId, data) => {
      operations.push(`input:${new TextDecoder().decode(data)}`);
    };
    const container = document.createElement("div");
    Object.defineProperties(container, {
      clientHeight: { value: 400 },
      clientWidth: { value: 800 },
    });
    document.body.append(container);
    const mount = mountInteractiveTerminal({
      container,
      terminalId: "terminal-1",
      controller,
      isActive: () => true,
      getPlatform: () => "darwin",
      stageFile: async () => "/tmp/image.png",
      preparePathInput: async () => "/tmp/image.png",
      writeClipboard: async () => undefined,
      onAttention: () => undefined,
      onLifecycle: () => undefined,
      onForgotten: () => undefined,
      onTitleChange: () => undefined,
      onHydrated: () => undefined,
      onImageDragActiveChange: () => undefined,
      onInteractionFailure: (_title, cause) => {
        throw cause;
      },
    });
    try {
      await nextFrame();
      operations.length = 0;
      const listener = listeners.get("terminal-1");
      if (!listener) throw new Error("Expected terminal to subscribe.");
      listener(
        {
          version: TERMINAL_PROTOCOL_VERSION,
          type: "screen_restore",
          terminalId: "terminal-1",
          sequenceEnd: 1,
          columns: 80,
          rows: 24,
          precedingJoinState: 2,
        },
        new TextEncoder().encode("restored"),
      );
      lightweight.sendInput("a");
      await Promise.resolve();
      expect(operations).toEqual([]);
      expect(lightweight.binding.terminal._core._inputHandler._parser.precedingJoinState).toBe(0);
      expect(lightweight.binding.terminal.resize).toHaveBeenCalledWith(80, 24);
      expect(lightweight.readOutput()).toBe("restored");
      lightweight.parsedCallbacks[0]?.();
      await Bun.sleep(0);
      expect(lightweight.binding.terminal._core._inputHandler._parser.precedingJoinState).toBe(2);
      expect(lightweight.readOutput()).toBe("restored");
      expect(operations).toEqual(["resize:120x40", "input:a"]);
    } finally {
      mount.dispose();
      container.remove();
      createBinding.mockRestore();
    }
  });

  test("hydrates and retains 96 terminal identities through the binding boundary", async () => {
    const bindings: ReturnType<typeof createLightweightBinding>[] = [];
    const createBinding = spyOn(sharedTerminalBinding, "createTerminalBinding").mockImplementation(
      () => {
        const lightweight = createLightweightBinding();
        bindings.push(lightweight);
        // SAFETY: the fake terminal and fit add-on cover every member this test exercises.
        return Object.assign(Object.create(null), lightweight.binding) as TerminalBinding;
      },
    );
    const { controller, listeners } = createController();
    const releaseEmulator = spyOn(controller, "releaseEmulator");
    const acknowledge = spyOn(controller, "acknowledge");
    const activeTerminalIds = new Set<string>(["terminal-0"]);
    const hydratedTerminalIds = new Set<string>();
    let finishHydration: () => void = () => undefined;
    const allHydrated = new Promise<void>((resolve) => {
      finishHydration = resolve;
    });
    const retained: Array<{
      container: HTMLDivElement;
      mount: InteractiveTerminalMount;
      terminalId: string;
    }> = [];

    try {
      for (let index = 0; index < PRODUCTION_TERMINAL_MOUNT_COUNT; index += 1) {
        const terminalId = `terminal-${index}`;
        const container = document.createElement("div");
        Object.defineProperties(container, {
          clientHeight: { value: 400 },
          clientWidth: { value: 800 },
        });
        document.body.append(container);
        const mount = mountInteractiveTerminal({
          container,
          terminalId,
          controller,
          isActive: () => activeTerminalIds.has(terminalId),
          getPlatform: () => "darwin",
          stageFile: async () => "/tmp/image.png",
          preparePathInput: async () => "/tmp/image.png",
          writeClipboard: async () => undefined,
          onAttention: () => undefined,
          onLifecycle: () => undefined,
          onForgotten: () => undefined,
          onTitleChange: () => undefined,
          onHydrated: () => {
            hydratedTerminalIds.add(terminalId);
            if (hydratedTerminalIds.size === PRODUCTION_TERMINAL_MOUNT_COUNT) finishHydration();
          },
          onImageDragActiveChange: () => undefined,
          onInteractionFailure: () => undefined,
        });
        retained.push({ container, mount, terminalId });
        const listener = listeners.get(terminalId);
        if (!listener) throw new Error(`Expected ${terminalId} to subscribe.`);
        sendStaleBuffer(listener, terminalId);
      }
      await Promise.resolve();
      expect(hydratedTerminalIds.size).toBe(0);
      expect(acknowledge).not.toHaveBeenCalled();
      for (const { parsedCallbacks } of bindings) {
        expect(parsedCallbacks).toHaveLength(1);
        for (const parsed of parsedCallbacks) parsed();
      }
      await allHydrated;

      expect(createBinding).toHaveBeenCalledTimes(PRODUCTION_TERMINAL_MOUNT_COUNT);
      expect(listeners.size).toBe(PRODUCTION_TERMINAL_MOUNT_COUNT);
      expect(retained).toHaveLength(PRODUCTION_TERMINAL_MOUNT_COUNT);
      for (const [index, current] of retained.entries()) {
        expect(hydratedTerminalIds.has(current.terminalId)).toBe(true);
        const output = `${current.terminalId} stale log\r\n`.repeat(STALE_BUFFER_LINES);
        expect(bindings[index]?.readOutput()).toBe(output);
        expect(acknowledge).toHaveBeenCalledWith(
          current.terminalId,
          new TextEncoder().encode(output).byteLength,
        );
      }
      for (const index of [0, 31, 32, PRODUCTION_TERMINAL_MOUNT_COUNT - 1]) {
        const current = retained[index];
        if (!current) throw new Error("Expected retained terminal.");
        activeTerminalIds.clear();
        activeTerminalIds.add(current.terminalId);
        const lightweight = bindings[index];
        if (!lightweight) throw new Error("Expected retained binding.");
        const { binding } = lightweight;
        binding.fitAddon.fit.mockClear();
        current.mount.activate(false);
        current.mount.activate(true);
        expect(binding.fitAddon.fit).toHaveBeenCalledTimes(2);
        expect(binding.terminal.refresh).toHaveBeenCalledWith(0, 23);
        expect(binding.terminal.scrollToBottom).toHaveBeenCalledTimes(1);
        expect(binding.terminal.focus).toHaveBeenCalledTimes(1);
        expect(lightweight.readOutput()).toContain(`${current.terminalId} stale log`);
      }
      expect(createBinding).toHaveBeenCalledTimes(PRODUCTION_TERMINAL_MOUNT_COUNT);
      expect(listeners.size).toBe(PRODUCTION_TERMINAL_MOUNT_COUNT);
      expect(releaseEmulator).not.toHaveBeenCalled();
      for (const { binding } of bindings) expect(binding.dispose).not.toHaveBeenCalled();
    } finally {
      for (const { container, mount } of retained) {
        mount.dispose();
        mount.dispose();
        container.remove();
      }
      createBinding.mockRestore();
    }
    expect(listeners.size).toBe(0);
    expect(releaseEmulator).toHaveBeenCalledTimes(PRODUCTION_TERMINAL_MOUNT_COUNT);
    for (const { terminalId } of retained) expect(releaseEmulator).toHaveBeenCalledWith(terminalId);
    for (const { binding } of bindings) expect(binding.dispose).toHaveBeenCalledTimes(1);
  });

  test("renders replay output after activating retained real-xterm mounts", async () => {
    const { controller, listeners } = createController();
    let activeTerminalId: string | null = null;
    const retained: Array<{ container: HTMLDivElement; mount: InteractiveTerminalMount }> = [];
    try {
      for (const terminalId of ["terminal-first", "terminal-last"]) {
        const container = document.createElement("div");
        Object.defineProperties(container, {
          clientHeight: { value: 400 },
          clientWidth: { value: 800 },
        });
        document.body.append(container);
        let finishHydration: () => void = () => undefined;
        const hydrated = new Promise<void>((resolve) => {
          finishHydration = resolve;
        });
        const mount = mountInteractiveTerminal({
          container,
          terminalId,
          controller,
          isActive: () => activeTerminalId === terminalId,
          getPlatform: () => "darwin",
          stageFile: async () => "/tmp/image.png",
          preparePathInput: async () => "/tmp/image.png",
          writeClipboard: async () => undefined,
          onAttention: () => undefined,
          onLifecycle: () => undefined,
          onForgotten: () => undefined,
          onTitleChange: () => undefined,
          onHydrated: finishHydration,
          onImageDragActiveChange: () => undefined,
          onInteractionFailure: (_title, cause) => {
            throw cause;
          },
        });
        retained.push({ container, mount });
        expect(container.querySelector(".xterm")).not.toBeNull();
        const listener = listeners.get(terminalId);
        if (!listener) throw new Error(`Expected ${terminalId} to subscribe.`);
        sendStaleBuffer(listener, terminalId);
        await hydrated;
        activeTerminalId = terminalId;
        mount.activate(false);
        await nextFrame();
        expect(container.textContent).toContain(`${terminalId} stale log`);
      }
      expect(listeners.size).toBe(2);
    } finally {
      for (const { container, mount } of retained) {
        mount.dispose();
        container.remove();
      }
    }
    expect(listeners.size).toBe(0);
  });

  test("does not focus a retained terminal after delayed image staging", async () => {
    const { controller } = createController();
    const container = document.createElement("div");
    Object.defineProperties(container, {
      clientHeight: { value: 400 },
      clientWidth: { value: 800 },
    });
    document.body.append(container);
    let active = true;
    let releaseStage: (path: string) => void = () => undefined;
    const stagedPath = new Promise<string>((resolve) => {
      releaseStage = resolve;
    });
    let finishPreparation: () => void = () => undefined;
    const preparationFinished = new Promise<void>((resolve) => {
      finishPreparation = resolve;
    });
    const mount = mountInteractiveTerminal({
      container,
      terminalId: "terminal-image-drop",
      controller,
      isActive: () => active,
      getPlatform: () => "darwin",
      stageFile: () => stagedPath,
      preparePathInput: async () => {
        finishPreparation();
        return "/tmp/image.png";
      },
      writeClipboard: async () => undefined,
      onAttention: () => undefined,
      onLifecycle: () => undefined,
      onForgotten: () => undefined,
      onTitleChange: () => undefined,
      onHydrated: () => undefined,
      onImageDragActiveChange: () => undefined,
      onInteractionFailure: () => undefined,
    });

    try {
      const drop = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(drop, "dataTransfer", {
        value: {
          files: [new File([new Uint8Array([1])], "image.png", { type: "image/png" })],
          items: [],
        },
      });
      container.dispatchEvent(drop);
      await Promise.resolve();
      active = false;
      releaseStage("/tmp/image.png");
      await preparationFinished;
      await Promise.resolve();

      expect(container.contains(document.activeElement)).toBe(false);
    } finally {
      mount.dispose();
      container.remove();
    }
  });
});
