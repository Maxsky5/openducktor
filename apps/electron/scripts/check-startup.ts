import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { persistedGlobalConfigV4Schema } from "@openducktor/contracts";
import { z } from "zod";

const WINDOW_CREATED_MARKER = "ODT_ELECTRON_STARTUP_WINDOW_CREATED";
const electronPackageRoot = fileURLToPath(new URL("../", import.meta.url));
const electronExecutable = z
  .string()
  .min(1)
  .parse(createRequire(new URL("../package.json", import.meta.url))("electron"));
const mainPath = path.join(electronPackageRoot, "dist", "main.js");
const hookPath = fileURLToPath(new URL("./startup-window-hook.cjs", import.meta.url));

if (process.platform !== "darwin") {
  throw new Error("Electron startup smoke test requires macOS.");
}

const configDir = await mkdtemp(path.join(tmpdir(), "openducktor-electron-startup-"));
try {
  await writeFile(
    path.join(configDir, "config.json"),
    JSON.stringify(persistedGlobalConfigV4Schema.parse({ version: 4 })),
  );

  const { ELECTRON_RUN_AS_NODE: _electronRunAsNode, ...environment } = process.env;
  const electron = spawn(electronExecutable, [mainPath], {
    cwd: electronPackageRoot,
    env: {
      ...environment,
      NODE_OPTIONS: `--require=${JSON.stringify(hookPath)}`,
      OPENDUCKTOR_CONFIG_DIR: configDir,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const closed = new Promise<void>((resolve) => electron.once("close", () => resolve()));

  let stdout = "";
  let stderr = "";
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };
      const failure = (message: string) =>
        new Error(`${message}\nElectron stdout:\n${stdout}\nElectron stderr:\n${stderr}`);
      const timeout = setTimeout(
        () => finish(failure("Electron did not create a window in 30 seconds.")),
        30_000,
      );

      electron.stdout.on("data", (chunk: Buffer) => {
        stdout = `${stdout}${chunk.toString()}`.slice(-8_000);
        if (stdout.includes(WINDOW_CREATED_MARKER)) finish();
      });
      electron.stderr.on("data", (chunk: Buffer) => {
        stderr = `${stderr}${chunk.toString()}`.slice(-8_000);
      });
      electron.once("error", (cause) =>
        finish(failure(`Electron could not start: ${cause.message}`)),
      );
      electron.once("exit", (code, signal) =>
        finish(failure(`Electron exited before it created a window (${code ?? signal}).`)),
      );
    });
    console.log("Electron created its main window with saved settings.");
  } finally {
    if (electron.exitCode === null && electron.signalCode === null) {
      electron.kill("SIGTERM");
    }
    const forceStop = setTimeout(() => electron.kill("SIGKILL"), 5_000);
    await closed;
    clearTimeout(forceStop);
  }
} finally {
  await rm(configDir, { recursive: true, force: true });
}
