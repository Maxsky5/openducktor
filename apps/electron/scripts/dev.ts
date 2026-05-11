type ManagedProcess = {
  name: string;
  process: Bun.Subprocess<"ignore", "inherit", "inherit">;
};

const runStep = async (label: string, command: string[]): Promise<void> => {
  const process = Bun.spawn(command, {
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await process.exited;
  if (exitCode !== 0) {
    throw new Error(`${label} failed with exit code ${exitCode}.`);
  }
};

export const resolveRendererDevUrl = (rawUrl: string | undefined): string => {
  const rendererUrl = rawUrl?.trim();

  if (!rendererUrl) {
    throw new Error("VITE_DEV_SERVER_URL is required for Electron development.");
  }

  const parsedUrl = new URL(rendererUrl);
  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error(`VITE_DEV_SERVER_URL must be an http or https URL: ${rendererUrl}`);
  }

  if (!parsedUrl.port) {
    throw new Error(`VITE_DEV_SERVER_URL must include an explicit port: ${rendererUrl}`);
  }

  return rendererUrl.replace(/\/$/u, "");
};

const waitForRenderer = async (rendererDevUrl: string): Promise<void> => {
  const startedAt = Date.now();
  const timeoutMs = 30_000;

  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetch(rendererDevUrl).catch(() => null);
    if (response?.ok) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`Timed out waiting for Electron renderer dev server at ${rendererDevUrl}.`);
};

const stopProcesses = (processes: ManagedProcess[]): void => {
  for (const managedProcess of processes) {
    if (!managedProcess.process.killed) {
      managedProcess.process.kill();
    }
  }
};

const main = async (): Promise<void> => {
  const rendererDevUrl = resolveRendererDevUrl(process.env.VITE_DEV_SERVER_URL);

  await runStep("Electron main build", ["bun", "run", "build:main"]);
  await runStep("Electron preload build", ["bun", "run", "build:preload"]);
  await waitForRenderer(rendererDevUrl);

  const processes: ManagedProcess[] = [];

  const cleanup = (): void => {
    stopProcesses(processes);
  };
  process.once("SIGINT", cleanup);
  process.once("SIGTERM", cleanup);
  process.once("exit", cleanup);

  const electron = Bun.spawn(["electron", "dist/main.js"], {
    stdout: "inherit",
    stderr: "inherit",
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: rendererDevUrl,
    },
  });
  processes.push({ name: "Electron", process: electron });

  const exitCode = await electron.exited;
  cleanup();
  if (exitCode !== 0) {
    throw new Error(`Electron exited with code ${exitCode}.`);
  }
};

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
