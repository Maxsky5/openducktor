type ConsoleMethod = "debug" | "error" | "info" | "log" | "warn";
type ConsoleArguments = Parameters<Console["log"]>;

export type CapturedConsoleCalls = ConsoleArguments[];

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
