const repoRoot = "/Users/20017260/projects/perso/openducktor";
const backendPort = process.env.ODT_BROWSER_BACKEND_PORT ?? "14327";
const backendUrl = `http://127.0.0.1:${backendPort}`;

const backendProcess = Bun.spawn({
  cmd: ["cargo", "run", "--bin", "browser_backend"],
  cwd: `${repoRoot}/apps/desktop/src-tauri`,
  env: {
    ...process.env,
    ODT_BROWSER_BACKEND_PORT: backendPort,
  },
  stdout: "inherit",
  stderr: "inherit",
});

let frontendProcess: Bun.Subprocess | null = null;

const stopChildren = () => {
  backendProcess.kill();
  frontendProcess?.kill();
};

process.on("SIGINT", () => {
  stopChildren();
  process.exit(130);
});

process.on("SIGTERM", () => {
  stopChildren();
  process.exit(143);
});

const waitForBackend = async (): Promise<void> => {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 60_000) {
    try {
      const response = await fetch(`${backendUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {}

    await Bun.sleep(500);
  }

  throw new Error(`Timed out waiting for browser backend at ${backendUrl}.`);
};

try {
  await waitForBackend();

  frontendProcess = Bun.spawn({
    cmd: ["bun", "run", "--filter", "@openducktor/desktop", "dev:browser"],
    cwd: repoRoot,
    env: {
      ...process.env,
      VITE_ODT_BROWSER_BACKEND_URL: backendUrl,
    },
    stdout: "inherit",
    stderr: "inherit",
  });

  const [backendExitCode, frontendExitCode] = await Promise.all([
    backendProcess.exited,
    frontendProcess.exited,
  ]);

  process.exit(frontendExitCode || backendExitCode);
} catch (error) {
  stopChildren();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
