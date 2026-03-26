import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const backendPort = process.env.ODT_BROWSER_BACKEND_PORT ?? "14327";
const backendUrl = `http://127.0.0.1:${backendPort}`;

const backendEnv: Record<string, string> = {
  ...process.env,
  ODT_BROWSER_BACKEND_PORT: backendPort,
};

const backendProcess = Bun.spawn({
  cmd: ["cargo", "run", "--bin", "browser_backend"],
  cwd: `${repoRoot}/apps/desktop/src-tauri`,
  env: backendEnv,
  stdout: "inherit",
  stderr: "inherit",
});

let frontendProcess: Bun.Subprocess | null = null;
let stoppingChildren = false;

const stopChildren = () => {
  if (stoppingChildren) {
    return;
  }
  stoppingChildren = true;
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
  await Promise.race([
    waitForBackend(),
    backendProcess.exited.then((exitCode) => {
      throw new Error(`Browser backend exited before startup completed with code ${exitCode}.`);
    }),
  ]);

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

  const firstExit = await Promise.race([
    backendProcess.exited.then((exitCode) => ({
      exitCode,
      processName: "backend" as const,
    })),
    frontendProcess.exited.then((exitCode) => ({
      exitCode,
      processName: "frontend" as const,
    })),
  ]);

  stopChildren();

  if (firstExit.processName === "backend") {
    await frontendProcess.exited;
  } else {
    await backendProcess.exited;
  }

  process.exit(firstExit.exitCode);
} catch (error) {
  stopChildren();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
