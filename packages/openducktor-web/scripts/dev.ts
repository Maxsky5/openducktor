import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptDirectory, "..");

const WEB_DEV_SIGNAL_EXIT_CODES: Partial<Record<NodeJS.Signals, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

export const resolveForwardedSignalExitCode = (signal: NodeJS.Signals): number =>
  WEB_DEV_SIGNAL_EXIT_CODES[signal] ?? 1;

export const buildWebDevCommand = (args: readonly string[]): string[] => [
  "bun",
  "src/cli.ts",
  ...args,
];

export const runWebDev = async (args: readonly string[] = process.argv.slice(2)): Promise<void> => {
  const subprocess = Bun.spawn(buildWebDevCommand(args), {
    cwd: packageRoot,
    env: { ...process.env, FORCE_COLOR: "1" },
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });

  let forwardedSignal: NodeJS.Signals | null = null;
  const forwardSignal = (signal: NodeJS.Signals): void => {
    forwardedSignal = signal;
    subprocess.kill(signal);
  };
  const forwardSigint = (): void => forwardSignal("SIGINT");
  const forwardSigterm = (): void => forwardSignal("SIGTERM");

  process.once("SIGINT", forwardSigint);
  process.once("SIGTERM", forwardSigterm);

  const exitCode = await subprocess.exited;
  process.off("SIGINT", forwardSigint);
  process.off("SIGTERM", forwardSigterm);

  if (exitCode === 0) {
    return;
  }

  if (forwardedSignal) {
    process.exitCode = resolveForwardedSignalExitCode(forwardedSignal);
    return;
  }

  throw new Error(`Web dev launcher failed with exit code ${exitCode}.`);
};

if (import.meta.main) {
  await runWebDev();
}
