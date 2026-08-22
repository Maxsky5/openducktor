import { hasRuntimeType } from "@openducktor/contracts";

interface CallsByMethodContract extends Record<ConsoleMethod, CapturedConsoleCalls> {}

interface ChunksByStreamContract extends Record<WritableStreamName, string[]> {}
type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";
type ConsoleArguments = Parameters<Console["log"]>;

export type CapturedConsoleCalls = ConsoleArguments[];

type ConsoleMethodMap = Record<ConsoleMethod, (...args: ConsoleArguments) => void>;

type WritableStreamName = "stderr" | "stdout";

type WritableStreamLike = {
  write: (chunk: string | Uint8Array, ...args: Array<string | (() => void)>) => boolean;
};

export const withCapturedConsole = async <Result>(
  method: ConsoleMethod,
  run: (calls: CapturedConsoleCalls) => Promise<Result> | Result,
): Promise<Result> => {
  // SAFETY: This test controls the fixture and supplies `ConsoleMethodMap` used by this case.
  const consoleMethods = console as ConsoleMethodMap;
  const original = consoleMethods[method];
  const calls: CapturedConsoleCalls = [];

  consoleMethods[method] = (...args: ConsoleArguments): void => {
    calls.push(args);
  };

  try {
    return await run(calls);
  } finally {
    consoleMethods[method] = original;
  }
};

export const withCapturedConsoleMethods = async <Result>(
  methods: readonly ConsoleMethod[],
  run: (callsByMethod: Record<ConsoleMethod, CapturedConsoleCalls>) => Promise<Result> | Result,
): Promise<Result> => {
  // SAFETY: This test controls the fixture and supplies `ConsoleMethodMap` used by this case.
  const consoleMethods = console as ConsoleMethodMap;
  const originals = new Map<ConsoleMethod, (...args: ConsoleArguments) => void>();
  const callsByMethod: CallsByMethodContract = {
    debug: [],
    error: [],
    info: [],
    log: [],
    warn: [],
  };

  for (const method of methods) {
    originals.set(method, consoleMethods[method]);
    consoleMethods[method] = (...args: ConsoleArguments): void => {
      callsByMethod[method].push(args);
    };
  }

  try {
    return await run(callsByMethod);
  } finally {
    for (const [method, original] of originals) {
      consoleMethods[method] = original;
    }
  }
};

export const withCapturedOutputStreams = async <Result>(
  streamNames: readonly WritableStreamName[],
  run: (chunksByStream: Record<WritableStreamName, string[]>) => Promise<Result> | Result,
): Promise<Result> => {
  // SAFETY: This test controls the fixture and supplies `Record<WritableStreamName, WritableStreamLike>` used by this case.
  const streams = process as Record<WritableStreamName, WritableStreamLike>;
  const originals = new Map<WritableStreamName, WritableStreamLike["write"]>();
  const chunksByStream: ChunksByStreamContract = {
    stderr: [],
    stdout: [],
  };

  for (const streamName of streamNames) {
    const stream = streams[streamName];
    originals.set(streamName, stream.write.bind(stream));
    stream.write = (chunk: string | Uint8Array, ...args: Array<string | (() => void)>): boolean => {
      chunksByStream[streamName].push(String(chunk));
      let callback: (() => void) | null = null;
      for (const arg of args) {
        if (hasRuntimeType(arg, "function")) {
          callback = () => {
            arg();
          };
          break;
        }
      }
      callback?.();
      return true;
    };
  }

  try {
    return await run(chunksByStream);
  } finally {
    for (const [streamName, original] of originals) {
      streams[streamName].write = original;
    }
  }
};
