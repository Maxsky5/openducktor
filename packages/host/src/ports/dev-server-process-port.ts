export type DevServerProcessExit = {
  pid: number;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
};

export type DevServerProcessOutput = {
  data: string;
};

export type DevServerProcessStartInput = {
  command: string;
  cwd: string;
  env?: Record<string, string>;
  onExit: (exit: DevServerProcessExit) => void;
  onOutput: (output: DevServerProcessOutput) => void;
};

export type DevServerProcessHandle = {
  pid: number;
  stop(): Promise<void>;
};

export type DevServerProcessPort = {
  start(input: DevServerProcessStartInput): Promise<DevServerProcessHandle>;
};

export class DevServerProcessStartExitError extends Error {
  readonly exitCode: number | null;
  readonly signal: string | null;

  constructor(exitCode: number | null, signal: string | null) {
    super(devServerExitMessage(exitCode, signal));
    this.name = "DevServerProcessStartExitError";
    this.exitCode = exitCode;
    this.signal = signal;
  }
}

export const devServerExitMessage = (exitCode: number | null, signal: string | null): string => {
  if (exitCode !== null) {
    return `Dev server exited with code ${exitCode}.`;
  }

  if (signal !== null) {
    return `Dev server exited after receiving signal ${signal}.`;
  }

  return "Dev server exited after receiving a signal.";
};
