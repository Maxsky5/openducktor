const child = Bun.spawn({
  cmd: ["bun", "packages/openducktor-web/src/cli.ts", "--workspace", ...process.argv.slice(2)],
  cwd: new URL("..", import.meta.url).pathname,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: {
    ...process.env,
    FORCE_COLOR: process.env.FORCE_COLOR ?? "1",
  },
});

const FORCE_EXIT_SIGNAL_GRACE_MS = 1_500;
const signalExitCodes: Partial<Record<NodeJS.Signals, number>> = {
  SIGINT: 130,
  SIGTERM: 143,
};

let firstSignalReceivedAt: number | null = null;
const forwardSignal = (signal: NodeJS.Signals): void => {
  const now = Date.now();
  if (firstSignalReceivedAt !== null) {
    if (now - firstSignalReceivedAt >= FORCE_EXIT_SIGNAL_GRACE_MS) {
      child.kill(9);
      process.exit(signalExitCodes[signal] ?? 1);
    }
    return;
  }

  firstSignalReceivedAt = now;
  child.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

process.exit(await child.exited);
