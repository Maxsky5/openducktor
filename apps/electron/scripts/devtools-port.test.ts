import { describe, expect, test } from "bun:test";
import { forwardElectronStderr, waitForDevToolsPort } from "./devtools-port";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const createElectronStderr = () => {
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });
  const controller = (): ReadableStreamDefaultController<Uint8Array> => {
    if (streamController === null) {
      throw new Error("The stderr stream did not start.");
    }
    return streamController;
  };
  return {
    close: () => controller().close(),
    fail: (cause: Error) => controller().error(cause),
    stream,
    write: (text: string) => controller().enqueue(encoder.encode(text)),
  };
};

const createOutput = () => {
  const chunks: string[] = [];
  let written: () => void = () => {};
  let writtenText = "";
  return {
    output: {
      write(chunk: Uint8Array) {
        chunks.push(decoder.decode(chunk));
        if (chunks.join("").includes(writtenText)) {
          written();
        }
      },
    },
    text: () => chunks.join(""),
    waitForText: (text: string): Promise<void> => {
      writtenText = text;
      return new Promise((resolve) => {
        written = resolve;
      });
    },
  };
};

type CapturedPortTimeout = {
  readonly promise: Promise<number | null>;
  readonly fire: () => void;
};

const startPortWaitWithCapturedTimeout = (
  devToolsPort: Promise<number>,
  signal: AbortSignal,
): CapturedPortTimeout => {
  const originalSetTimeout = globalThis.setTimeout;
  let capturedHandler: (() => void) | null = null;
  const captureSetTimeout = (
    handler: () => void,
    delay?: number,
  ): ReturnType<typeof setTimeout> => {
    capturedHandler = handler;
    return originalSetTimeout(handler, delay);
  };
  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    value: captureSetTimeout,
    writable: true,
  });
  const promise = waitForDevToolsPort(devToolsPort, signal);
  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    value: originalSetTimeout,
    writable: true,
  });
  return {
    fire: () => {
      if (capturedHandler === null) {
        throw new Error("The CDP port wait did not schedule a timeout.");
      }
      capturedHandler();
    },
    promise,
  };
};

describe("Electron DevTools port", () => {
  test("returns the port of the DevTools line and copies stderr to the output", async () => {
    const stderr = createElectronStderr();
    const { output, text } = createOutput();
    const port = forwardElectronStderr(stderr.stream, output);

    stderr.write("[main] starting\n\nDevTools listening on ws://127.0.0.1:45");
    stderr.write("678/devtools/browser/0b5c1f2e-6f3a-4c41-9d1e-0123456789ab\r\n");

    expect(await port).toBe(45_678);
    expect(text()).toBe(
      "[main] starting\n\nDevTools listening on ws://127.0.0.1:45678/devtools/browser/0b5c1f2e-6f3a-4c41-9d1e-0123456789ab\r\n",
    );
  });

  test("returns the port of an IPv6 DevTools endpoint", async () => {
    const stderr = createElectronStderr();
    const port = forwardElectronStderr(stderr.stream, createOutput().output);

    stderr.write("DevTools listening on ws://[::1]:45678/devtools/browser/example\n");

    expect(await port).toBe(45_678);
  });

  test("keeps copying stderr after the DevTools line", async () => {
    const stderr = createElectronStderr();
    const { output, text, waitForText } = createOutput();
    const port = forwardElectronStderr(stderr.stream, output);

    stderr.write("DevTools listening on ws://127.0.0.1:45678/devtools/browser/example\n");
    expect(await port).toBe(45_678);
    const laterOutput = waitForText("[main] later output\n");
    stderr.write("[main] later output\n");
    stderr.close();
    await laterOutput;

    expect(text()).toEndWith("[main] later output\n");
  });

  test("fails with a recovery step when stderr fails before the DevTools line", async () => {
    const stderr = createElectronStderr();
    const port = forwardElectronStderr(stderr.stream, createOutput().output);

    stderr.fail(new Error("EIO"));

    const failure = await port.catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toContain(
      "Failed to read the Electron output: EIO. Check the Electron startup output, then rerun `bun run electron:dev:cdp`.",
    );
  });

  test("waits for the published port", async () => {
    const controller = new AbortController();

    expect(await waitForDevToolsPort(Promise.resolve(45_678), controller.signal)).toBe(45_678);
  });

  test("stops waiting when the lifecycle aborts the wait", async () => {
    const controller = new AbortController();
    const portPromise = waitForDevToolsPort(new Promise<number>(() => {}), controller.signal);

    controller.abort();

    expect(await portPromise).toBeNull();
  });

  test("returns null when the lifecycle passes an aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();

    expect(await waitForDevToolsPort(new Promise<number>(() => {}), controller.signal)).toBeNull();
  });

  test("fails with a recovery step when Electron never prints the DevTools endpoint", async () => {
    const controller = new AbortController();
    const { fire, promise } = startPortWaitWithCapturedTimeout(
      new Promise<number>(() => {}),
      controller.signal,
    );

    fire();

    const failure = await promise.catch((cause: unknown) => cause);
    expect(String(failure)).toContain(
      "Electron did not print its DevTools endpoint within 30000ms. Check the Electron startup output, then rerun `bun run electron:dev:cdp`.",
    );
  });
});
