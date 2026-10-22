import { createBrowserEndSignal } from "../browser-engine-lifecycle";
import { type ChildProcess, spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { Data, Effect } from "effect";
import { errorMessage } from "../../../effect/host-errors";
import type { CdpConnection } from "../cdp/cdp-target-session";
import { type ChromePipeConnection, createChromePipeConnection } from "./chrome-pipe-connection";
import { CHROME_FOR_TESTING_DEBIAN_PACKAGES } from "./chrome-for-testing-pin";

const START_TIMEOUT_MS = 30_000;
const STOP_TIMEOUT_MS = 5_000;
const STDERR_TAIL_BYTES = 16_384;

export class ChromeLaunchError extends Data.TaggedError("ChromeLaunchError")<{
  readonly message: string;
  readonly missingLibraries: readonly string[];
  readonly cause?: unknown;
}> {}

export type ChromeProcessExit = { code: number | null; signal: string | null };

/** One running Chrome browser process and its DevTools pipe. */
export type ChromeProcess = {
  readonly connection: CdpConnection;
  /** Calls the listener once when the process ends, also when `stop` ends it. */
  onExit(listener: (exit: ChromeProcessExit) => void): () => void;
  /** Asks Chrome to close, then kills it if it does not exit in time. */
  stop(): Effect.Effect<void>;
};

type ChromeLaunchInput = {
  readonly executable: string;
  readonly profileDirectory: string;
  readonly platform: NodeJS.Platform;
};

export type ChromeLauncher = (
  input: ChromeLaunchInput,
) => Effect.Effect<ChromeProcess, ChromeLaunchError>;

/** Starts Chrome and waits until its DevTools pipe answers. */
export const launchChromeProcess: ChromeLauncher = (input) =>
  Effect.callback<ChromeProcess, ChromeLaunchError>((resume) => {
    let child: ChildProcess;
    try {
      child = spawn(input.executable, chromeLaunchArguments(input), {
        stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (cause) {
      resume(Effect.fail(launchFailure(input.profileDirectory, "", errorMessage(cause), cause)));
      return;
    }
    const stderr = createTextTail(STDERR_TAIL_BYTES);
    const exited = createBrowserEndSignal<ChromeProcessExit>();
    let connection: ChromePipeConnection | null = null;
    let settled = false;
    const settle = (effect: Effect.Effect<ChromeProcess, ChromeLaunchError>) => {
      if (settled) return;
      settled = true;
      clearTimeout(startTimer);
      resume(effect);
    };
    const startTimer = setTimeout(() => {
      child.kill("SIGKILL");
      settle(
        Effect.fail(
          launchFailure(
            input.profileDirectory,
            stderr.read(),
            `The DevTools pipe did not answer within ${START_TIMEOUT_MS / 1000} seconds.`,
          ),
        ),
      );
    }, START_TIMEOUT_MS);
    // An interrupted start ends Chrome.
    const cancel = Effect.sync(() => {
      if (settled) return;
      settled = true;
      clearTimeout(startTimer);
      child.kill("SIGKILL");
    });
    child.once("error", (error) => {
      settle(
        Effect.fail(launchFailure(input.profileDirectory, stderr.read(), error.message, error)),
      );
    });
    // `close` follows `exit` after stdio ends, so the stderr tail is complete here. After a
    // successful start, `settle` does nothing.
    child.once("close", (code, signal) => {
      const exit = { code, signal };
      connection?.close("Chrome exited.");
      settle(Effect.fail(launchFailure(input.profileDirectory, stderr.read(), exitDetail(exit))));
      exited.end(exit);
    });
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    const input3 = child.stdio[3];
    const output4 = child.stdio[4];
    if (!isWritable(input3) || !isReadable(output4)) {
      // Bun gives no pipes when the spawn fails. Its `error` event then reports the cause.
      child.kill("SIGKILL");
      return cancel;
    }
    const pipe = createChromePipeConnection({ input: input3, output: output4 });
    connection = pipe;

    const stop = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        if (exited.isEnded()) return;
        if (!pipe.isClosed()) {
          // The pipe can close first when Chrome is already ending.
          pipe.request("Browser.close", undefined, "").catch(() => undefined);
        }
        if (yield* waitForExit(child, STOP_TIMEOUT_MS)) return;
        child.kill("SIGKILL");
        yield* waitForExit(child, STOP_TIMEOUT_MS);
      });

    const chromeProcess: ChromeProcess = {
      connection: pipe,
      onExit: exited.onEnded,
      stop,
    };
    // Chrome answers on the pipe once it runs. A failed answer means that Chrome ended or that the
    // pipe broke. `close` then reports the exit code and stderr.
    pipe.request("Browser.getVersion", undefined, "").then(
      () => settle(Effect.succeed(chromeProcess)),
      () => {
        if (!exited.isEnded() && child.exitCode === null) {
          child.kill("SIGKILL");
        }
      },
    );
    return cancel;
  });

/**
 * The flags of each workspace browser. The pipe is the only DevTools transport, so no port opens.
 * Each tab gets its own window, so the flags that stop background throttling keep every tab drawn.
 */
const chromeLaunchArguments = (input: ChromeLaunchInput): string[] => [
  "--headless",
  "--remote-debugging-pipe",
  `--user-data-dir=${input.profileDirectory}`,
  "--no-startup-window",
  "--no-first-run",
  "--no-default-browser-check",
  "--force-device-scale-factor=2",
  "--deny-permission-prompts",
  "--disable-background-timer-throttling",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  // Page notifications become OpenDucktor notices. They must not reach the desktop of the host.
  "--disable-features=NativeNotifications,SystemNotifications",
  // Keep Chrome away from the OS keychain, which would ask the host user for access.
  ...(input.platform === "darwin" ? ["--use-mock-keychain"] : []),
  ...(input.platform === "linux" ? ["--password-store=basic"] : []),
];

/** Reads the libraries that the Linux dynamic loader could not find. */
const parseMissingSharedLibraries = (stderr: string): string[] => {
  const libraries = new Set<string>();
  for (const match of stderr.matchAll(
    /error while loading shared libraries: ([^:\s]+): cannot open shared object file/g,
  )) {
    if (match[1]) {
      libraries.add(match[1]);
    }
  }
  return Array.from(libraries);
};

const missingSharedLibrariesMessage = (libraries: readonly string[]): string =>
  `Chrome for Testing cannot start because these system libraries are missing: ${libraries.join(", ")}. Install the libraries that Chrome needs, then retry. On Debian or Ubuntu, run: sudo apt-get install -y ${CHROME_FOR_TESTING_DEBIAN_PACKAGES.join(" ")}`;

const launchFailure = (
  profileDirectory: string,
  stderr: string,
  detail: string,
  cause?: unknown,
): ChromeLaunchError => {
  // Chrome refuses a profile that another live Chrome process holds.
  if (stderr.includes("Failed to create a ProcessSingleton")) {
    return new ChromeLaunchError({
      message: `Another browser process uses the browser profile of this workspace in ${profileDirectory}. Another OpenDucktor app that uses the same config folder can hold it. Close that app, then reload the tab.`,
      missingLibraries: [],
      cause,
    });
  }
  const missingLibraries = parseMissingSharedLibraries(stderr);
  if (missingLibraries.length > 0) {
    return new ChromeLaunchError({
      message: missingSharedLibrariesMessage(missingLibraries),
      missingLibraries,
      cause,
    });
  }
  const output = stderr.trim();
  return new ChromeLaunchError({
    message: `Chrome for Testing did not start: ${detail}${output.length > 0 ? ` Chrome reported: ${output}` : ""}`,
    missingLibraries: [],
    cause,
  });
};

const createTextTail = (limit: number) => {
  let text = "";
  return {
    push(chunk: Buffer): void {
      text = (text + chunk.toString("utf8")).slice(-limit);
    },
    read: (): string => text,
  };
};

const isWritable = (stream: Readable | Writable | null | undefined): stream is Writable =>
  stream !== null && stream !== undefined && "write" in stream;

const isReadable = (stream: Readable | Writable | null | undefined): stream is Readable =>
  stream !== null && stream !== undefined && "read" in stream;

const exitDetail = (exit: ChromeProcessExit): string =>
  exit.signal === null
    ? `The process exited with code ${exit.code ?? "unknown"}.`
    : `The process ended with signal ${exit.signal}.`;

const waitForExit = (child: ChildProcess, timeoutMs: number): Effect.Effect<boolean> =>
  Effect.callback<boolean>((resume) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resume(Effect.succeed(true));
      return;
    }
    const onExit = () => {
      clearTimeout(timer);
      resume(Effect.succeed(true));
    };
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resume(Effect.succeed(false));
    }, timeoutMs);
    child.once("exit", onExit);
    return Effect.sync(() => {
      clearTimeout(timer);
      child.off("exit", onExit);
    });
  });
