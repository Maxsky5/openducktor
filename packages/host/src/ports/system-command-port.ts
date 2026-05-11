export type SystemCommandRunOptions = {
  cwd?: string;
  env?: Record<string, string>;
  timeoutMs?: number;
};

export type SystemCommandRunResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
};

export type SystemCommandPort = {
  requiredCommandError(command: string): Promise<string | null>;
  versionCommand(
    command: string,
    args: string[],
    options?: SystemCommandRunOptions,
  ): Promise<string | null>;
  runCommandAllowFailure(
    command: string,
    args: string[],
    options?: SystemCommandRunOptions,
  ): Promise<SystemCommandRunResult>;
};
