import { errorMessage } from "../src/effect/electron-errors";

const ELECTRON_DEBUG_PORT_TIMEOUT_MS = 30_000;
// Chromium prints this line to stderr when its DevTools server listens. See
// `StartServerOnHandlerThread` in content/browser/devtools/devtools_http_handler.cc.
const DEVTOOLS_LISTENING_LINE = /^DevTools listening on ws:\/\/\S+:(\d+)\/devtools\/browser\//;
export const DEVTOOLS_PORT_RECOVERY_STEP =
  "Check the Electron startup output, then rerun `bun run electron:dev:cdp`.";

type ElectronOutput = {
  write(chunk: Uint8Array): void;
};

const parseDevToolsPort = (lines: readonly string[]): number | null => {
  for (const line of lines) {
    const match = DEVTOOLS_LISTENING_LINE.exec(line.trimEnd());
    if (match?.[1] !== undefined) {
      return Number.parseInt(match[1], 10);
    }
  }
  return null;
};

// Copies the Electron stderr to `output` until Electron closes it. The promise gets the port of
// the first DevTools line. The pipe keeps the output until this function reads it, so the line
// cannot come too early. Read all of stderr: Electron stops when the pipe is full.
export const forwardElectronStderr = (
  stderr: ReadableStream<Uint8Array>,
  output: ElectronOutput,
): Promise<number> => {
  const { promise, resolve, reject } = Promise.withResolvers<number>();
  const decoder = new TextDecoder();
  let port: number | null = null;
  let partialLine = "";
  const forward = async (): Promise<void> => {
    for await (const chunk of stderr) {
      output.write(chunk);
      if (port !== null) {
        continue;
      }
      const lines = `${partialLine}${decoder.decode(chunk, { stream: true })}`.split("\n");
      partialLine = lines.pop() ?? "";
      port = parseDevToolsPort(lines);
      if (port !== null) {
        resolve(port);
      }
    }
  };
  void forward().catch((cause: unknown) => {
    const failure = `Failed to read the Electron output: ${errorMessage(cause)}. ${DEVTOOLS_PORT_RECOVERY_STEP}`;
    if (port === null) {
      reject(new Error(failure));
      return;
    }
    console.error(`[electron:dev] ${failure}`);
  });
  return promise;
};

// Electron closes stderr when it exits. The lifecycle then aborts the wait, so the wait does not
// end when the output ends.
export const waitForDevToolsPort = (
  devToolsPort: Promise<number>,
  signal: AbortSignal,
): Promise<number | null> =>
  new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }
    const settle = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", handleAbort);
    };
    const handleAbort = (): void => {
      settle();
      resolve(null);
    };
    const timeout = setTimeout(() => {
      settle();
      reject(
        new Error(
          `Electron did not print its DevTools endpoint within ${ELECTRON_DEBUG_PORT_TIMEOUT_MS}ms. ${DEVTOOLS_PORT_RECOVERY_STEP}`,
        ),
      );
    }, ELECTRON_DEBUG_PORT_TIMEOUT_MS);
    signal.addEventListener("abort", handleAbort, { once: true });
    devToolsPort.then(
      (port) => {
        settle();
        resolve(port);
      },
      (cause: unknown) => {
        settle();
        reject(cause);
      },
    );
  });
