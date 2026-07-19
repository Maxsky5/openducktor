import { Effect } from "effect";
import { processIsAlive } from "../infrastructure/process/process-tree";
import type { TerminalPtyExit, TerminalPtyPort } from "../ports/terminal-pty-port";

export type TerminalPtyConformanceObservation = {
  output: number[][];
  eventOrder: string[];
  operations: string[];
  supportsOutputPause: boolean;
  expectedOutputPause: boolean;
};

/** Shared observable contract used by every runtime-native PTY adapter test. */
export const assertTerminalPtyConformance = (
  observation: TerminalPtyConformanceObservation,
): void => {
  if (JSON.stringify(observation.output) !== "[[1,2]]") {
    throw new Error("PTY adapter did not preserve binary output bytes.");
  }
  if (observation.eventOrder.join(",") !== "output,exit") {
    throw new Error("PTY adapter did not publish final output before exit.");
  }
  if (!observation.operations.some((entry) => entry.startsWith("write:"))) {
    throw new Error("PTY adapter did not forward input.");
  }
  if (!observation.operations.some((entry) => entry.startsWith("resize:"))) {
    throw new Error("PTY adapter did not forward resize.");
  }
  if (observation.supportsOutputPause !== observation.expectedOutputPause) {
    throw new Error("PTY adapter reported the wrong output-pause capability.");
  }
};

export type LiveTerminalPtyConformanceObservation = {
  transcript: string;
  exit: TerminalPtyExit;
  eventOrder: string[];
};

const withTimeout = async <Value>(
  promise: Promise<Value>,
  timeoutMs: number,
  message: string,
): Promise<Value> => {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
};

/** Exercises a runtime adapter and a real shell process through the shared PTY port. */
export const observeLiveTerminalPtyConformance = async (
  port: TerminalPtyPort,
  shell = "/bin/sh",
): Promise<LiveTerminalPtyConformanceObservation> => {
  const decoder = new TextDecoder();
  let transcript = "";
  const eventOrder: string[] = [];
  let settleExit: ((exit: TerminalPtyExit) => void) | null = null;
  let rejectExit: ((failure: unknown) => void) | null = null;
  const exitPromise = new Promise<TerminalPtyExit>((resolve) => {
    settleExit = resolve;
  }).catch((failure) => {
    throw failure;
  });
  const failurePromise = new Promise<never>((_resolve, reject) => {
    rejectExit = reject;
  });
  const handle = await Effect.runPromise(
    port.start(
      {
        shell,
        args: [
          "-c",
          'printf "READY\\n"; IFS= read -r value; stty size; printf "INPUT:%s\\n" "$value"',
        ],
        cwd: process.cwd(),
        env: { ...process.env, TERM: "xterm-256color" },
        grid: { columns: 80, rows: 24 },
      },
      {
        onOutput: (data) => {
          transcript += decoder.decode(data, { stream: true });
          eventOrder.push("output");
        },
        onFailure: (failure) => {
          rejectExit?.(failure);
        },
        onExit: (exit) => {
          transcript += decoder.decode();
          eventOrder.push("exit");
          settleExit?.(exit);
        },
      },
    ),
  );
  try {
    await Effect.runPromise(handle.resize({ columns: 120, rows: 40 }));
    await Effect.runPromise(handle.write(new TextEncoder().encode("terminal-conformance\n")));
    const exit = await withTimeout(
      Promise.race([exitPromise, failurePromise]),
      5_000,
      "Timed out waiting for PTY conformance shell.",
    );
    return { transcript, exit, eventOrder };
  } catch (cause) {
    await Effect.runPromise(Effect.ignore(handle.terminate()));
    throw cause;
  }
};

export const verifyLiveTerminalPtyProcessTreeTermination = async (
  port: TerminalPtyPort,
  shell = "/bin/sh",
): Promise<number> => {
  const decoder = new TextDecoder();
  let transcript = "";
  let settleChildPid: ((pid: number) => void) | null = null;
  let rejectChildPid: ((failure: unknown) => void) | null = null;
  const childPidPromise = new Promise<number>((resolve) => {
    settleChildPid = resolve;
  });
  const failurePromise = new Promise<never>((_resolve, reject) => {
    rejectChildPid = reject;
  });
  const handle = await Effect.runPromise(
    port.start(
      {
        shell,
        args: ["-i"],
        cwd: process.cwd(),
        env: { ...process.env, PS1: "", TERM: "xterm-256color" },
        grid: { columns: 80, rows: 24 },
      },
      {
        onOutput: (data) => {
          transcript += decoder.decode(data, { stream: true });
          const match = /CHILD:(\d+)/.exec(transcript);
          if (match?.[1]) settleChildPid?.(Number(match[1]));
        },
        onFailure: (failure) => {
          rejectChildPid?.(failure);
        },
        onExit: () => undefined,
      },
    ),
  );
  let childPid: number | null = null;
  try {
    await Effect.runPromise(
      handle.write(
        new TextEncoder().encode(
          'sh -c \'trap "" HUP TERM; printf "CHILD:%s\\\\n" "$$"; while :; do sleep 60; done\'\n',
        ),
      ),
    );
    childPid = await withTimeout(
      Promise.race([childPidPromise, failurePromise]),
      5_000,
      "Timed out waiting for the PTY foreground process id.",
    );
    await Effect.runPromise(handle.terminate());
    const deadline = Date.now() + 1_000;
    while (Date.now() < deadline && processIsAlive(childPid)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    if (processIsAlive(childPid)) {
      throw new Error(`PTY descendant ${childPid} survived process-tree termination.`);
    }
    return childPid;
  } catch (cause) {
    await Effect.runPromise(Effect.ignore(handle.terminate()));
    throw cause;
  } finally {
    if (childPid !== null && processIsAlive(childPid)) {
      try {
        process.kill(-childPid, "SIGKILL");
      } catch {
        try {
          process.kill(childPid, "SIGKILL");
        } catch {
          // The fixture exited between the liveness check and cleanup.
        }
      }
    }
  }
};

export const verifyLiveTerminalPtyNaturalExitCleanup = async (
  port: TerminalPtyPort,
  shell = "/bin/sh",
): Promise<number> => {
  const decoder = new TextDecoder();
  let transcript = "";
  let settleChildPid: ((pid: number) => void) | null = null;
  let settleExit: ((exit: TerminalPtyExit) => void) | null = null;
  let rejectSession: ((failure: unknown) => void) | null = null;
  const childPidPromise = new Promise<number>((resolve) => {
    settleChildPid = resolve;
  });
  const exitPromise = new Promise<TerminalPtyExit>((resolve) => {
    settleExit = resolve;
  });
  const failurePromise = new Promise<never>((_resolve, reject) => {
    rejectSession = reject;
  });
  const handle = await Effect.runPromise(
    port.start(
      {
        shell,
        args: ["-c", 'sleep 60 & child=$!; printf "CHILD:%s\\n" "$child"; exit 0'],
        cwd: process.cwd(),
        env: { ...process.env, TERM: "xterm-256color" },
        grid: { columns: 80, rows: 24 },
      },
      {
        onOutput: (data) => {
          transcript += decoder.decode(data, { stream: true });
          const match = /CHILD:(\d+)/.exec(transcript);
          if (match?.[1]) settleChildPid?.(Number(match[1]));
        },
        onFailure: (failure) => rejectSession?.(failure),
        onExit: (exit) => settleExit?.(exit),
      },
    ),
  );
  try {
    const childPid = await withTimeout(
      Promise.race([childPidPromise, failurePromise]),
      5_000,
      "Timed out waiting for the natural-exit descendant process id.",
    );
    await withTimeout(
      Promise.race([exitPromise, failurePromise]),
      5_000,
      "Timed out waiting for PTY natural-exit cleanup.",
    );
    if (processIsAlive(childPid)) {
      throw new Error(`PTY descendant ${childPid} survived its shell's natural exit.`);
    }
    return childPid;
  } catch (cause) {
    await Effect.runPromise(Effect.ignore(handle.terminate()));
    throw cause;
  }
};

export const verifyLiveTerminalPtyInterrupt = async (
  port: TerminalPtyPort,
  shell = "/bin/sh",
): Promise<TerminalPtyExit> => {
  const decoder = new TextDecoder();
  let transcript = "";
  let settleReady: (() => void) | null = null;
  let settleExit: ((exit: TerminalPtyExit) => void) | null = null;
  let rejectSession: ((failure: unknown) => void) | null = null;
  const readyPromise = new Promise<void>((resolve) => {
    settleReady = resolve;
  });
  const exitPromise = new Promise<TerminalPtyExit>((resolve) => {
    settleExit = resolve;
  });
  const failurePromise = new Promise<never>((_resolve, reject) => {
    rejectSession = reject;
  });
  const handle = await Effect.runPromise(
    port.start(
      {
        shell,
        args: [
          "-c",
          `trap 'printf "INTERRUPTED\\n"; exit 130' INT; printf "READY\\n"; while :; do sleep 1; done`,
        ],
        cwd: process.cwd(),
        env: { ...process.env, TERM: "xterm-256color" },
        grid: { columns: 80, rows: 24 },
      },
      {
        onOutput: (data) => {
          transcript += decoder.decode(data, { stream: true });
          if (transcript.includes("READY")) settleReady?.();
        },
        onFailure: (failure) => rejectSession?.(failure),
        onExit: (exit) => settleExit?.(exit),
      },
    ),
  );
  try {
    await withTimeout(
      Promise.race([readyPromise, failurePromise]),
      5_000,
      "Timed out waiting for the PTY interrupt fixture.",
    );
    await Effect.runPromise(handle.write(new Uint8Array([3])));
    const exit = await withTimeout(
      Promise.race([exitPromise, failurePromise]),
      5_000,
      "Timed out waiting for the PTY interrupt exit.",
    );
    if (!transcript.includes("INTERRUPTED")) {
      throw new Error("PTY Ctrl+C input did not interrupt the foreground shell.");
    }
    return exit;
  } catch (cause) {
    await Effect.runPromise(Effect.ignore(handle.terminate()));
    throw cause;
  }
};
