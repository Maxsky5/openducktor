import { resolve } from "node:path";

const repoRoot = resolve(import.meta.dir, "..");
const backendPort = process.env.ODT_BROWSER_BACKEND_PORT ?? "14327";
const backendUrl = `http://127.0.0.1:${backendPort}`;

const backendEnv: Record<string, string> = {
  ...process.env,
  ODT_BROWSER_BACKEND_PORT: backendPort,
};

const backendProcess = Bun.spawn({
  cmd: [
    "cargo",
    "run",
    "--bin",
    "openducktor-desktop",
    "--",
    "--browser-backend",
    "--port",
    backendPort,
  ],
  cwd: `${repoRoot}/apps/desktop/src-tauri`,
  detached: true,
  env: backendEnv,
  stdout: "inherit",
  stderr: "inherit",
});
let backendExited = false;
void backendProcess.exited.then(() => {
  backendExited = true;
});

let frontendProcess: Bun.Subprocess | null = null;
let stoppingChildren = false;

const requestBackendShutdown = async (): Promise<void> => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3_000);
    await fetch(`${backendUrl}/shutdown`, {
      method: "POST",
      signal: controller.signal,
    });
    clearTimeout(timeout);
  } catch {}
};

const terminateProcessGroup = async (child: Bun.Subprocess | null): Promise<void> => {
  if (!child) {
    return;
  }

  const pid = child.pid;
  if (typeof pid === "number" && pid > 0) {
    try {
      process.kill(-pid, "SIGTERM");
    } catch {}
  }

  child.kill();
  await Promise.race([child.exited, Bun.sleep(3_000)]);

  if (typeof pid === "number" && pid > 0) {
    try {
      process.kill(-pid, 0);
      try {
        process.kill(-pid, "SIGKILL");
      } catch {}
    } catch {}
  }

  child.kill(9);
  await Promise.race([child.exited, Bun.sleep(1_000)]);
};

const stopChildren = async () => {
  if (stoppingChildren) {
    return;
  }
  stoppingChildren = true;

  await Promise.allSettled([requestBackendShutdown(), terminateProcessGroup(frontendProcess)]);

  await Promise.race([backendProcess.exited, Bun.sleep(4_000)]);

  if (!backendExited) {
    await terminateProcessGroup(backendProcess);
  }
};

process.on("SIGINT", () => {
  void stopChildren().finally(() => process.exit(130));
});

process.on("SIGTERM", () => {
  void stopChildren().finally(() => process.exit(143));
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
    detached: true,
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

  await stopChildren();

  if (firstExit.processName === "backend") {
    await frontendProcess.exited;
  } else {
    await backendProcess.exited;
  }

  process.exit(firstExit.exitCode);
} catch (error) {
  await stopChildren();
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
