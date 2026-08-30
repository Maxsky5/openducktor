import { z } from "zod";

type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";
type ConsoleArguments = Parameters<Console["log"]>;

export type CapturedConsoleCalls = ConsoleArguments[];

type WritableStreamName = "stderr" | "stdout";

type WritableStreamWrite = (typeof process.stdout)["write"];
type WriteCallback = (error?: Error | null) => void;

const writeCallbackSchema = z.function();

export const withCapturedConsole = async <Result>(
  method: ConsoleMethod,
  run: (calls: CapturedConsoleCalls) => Promise<Result> | Result,
): Promise<Result> => {
  const original = console[method];
  const calls: CapturedConsoleCalls = [];

  console[method] = (...args: ConsoleArguments): void => {
    calls.push(args);
  };

  try {
    return await run(calls);
  } finally {
    console[method] = original;
  }
};

export const withCapturedConsoleMethods = async <Result>(
  methods: readonly ConsoleMethod[],
  run: (callsByMethod: Record<ConsoleMethod, CapturedConsoleCalls>) => Promise<Result> | Result,
): Promise<Result> => {
  const originals = new Map<ConsoleMethod, (...args: ConsoleArguments) => void>();
  const callsByMethod = {
    debug: new Array<ConsoleArguments>(),
    error: new Array<ConsoleArguments>(),
    info: new Array<ConsoleArguments>(),
    log: new Array<ConsoleArguments>(),
    warn: new Array<ConsoleArguments>(),
  } satisfies Record<ConsoleMethod, CapturedConsoleCalls>;

  for (const method of methods) {
    originals.set(method, console[method]);
    console[method] = (...args: ConsoleArguments): void => {
      callsByMethod[method].push(args);
    };
  }

  try {
    return await run(callsByMethod);
  } finally {
    for (const [method, original] of originals) {
      console[method] = original;
    }
  }
};

export const withCapturedOutputStreams = async <Result>(
  streamNames: readonly WritableStreamName[],
  run: (chunksByStream: Record<WritableStreamName, string[]>) => Promise<Result> | Result,
): Promise<Result> => {
  const originals = new Map<WritableStreamName, WritableStreamWrite>();
  const chunksByStream = {
    stderr: new Array<string>(),
    stdout: new Array<string>(),
  } satisfies Record<WritableStreamName, string[]>;

  for (const streamName of streamNames) {
    const stream = process[streamName];
    originals.set(streamName, stream.write.bind(stream));
    function captureWrite(chunk: string | Uint8Array, callback?: WriteCallback): boolean;
    function captureWrite(
      chunk: string | Uint8Array,
      encoding?: BufferEncoding,
      callback?: WriteCallback,
    ): boolean;
    function captureWrite(
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | WriteCallback,
      callback?: WriteCallback,
    ): boolean {
      chunksByStream[streamName].push(String(chunk));
      const parsedWriteCallback = writeCallbackSchema.safeParse(encodingOrCallback);
      const writeCallback = parsedWriteCallback.success ? parsedWriteCallback.data : callback;
      writeCallback?.();
      return true;
    }
    stream.write = captureWrite;
  }

  try {
    return await run(chunksByStream);
  } finally {
    for (const [streamName, original] of originals) {
      process[streamName].write = original;
    }
  }
};
