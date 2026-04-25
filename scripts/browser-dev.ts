const child = Bun.spawn({
  cmd: ["bun", "packages/openducktor-web/src/cli.ts", "--workspace"],
  cwd: new URL("..", import.meta.url).pathname,
  stdout: "inherit",
  stderr: "inherit",
  stdin: "inherit",
  env: {
    ...process.env,
    FORCE_COLOR: process.env.FORCE_COLOR ?? "1",
  },
});

let shuttingDown = false;
const forwardSignal = (signal: NodeJS.Signals): void => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  child.kill(signal);
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

process.exit(await child.exited);
