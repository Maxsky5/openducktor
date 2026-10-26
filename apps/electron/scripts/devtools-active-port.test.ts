import { describe, expect, test } from "bun:test";
import { symlinkSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Effect } from "effect";
import {
  prepareDevToolsActivePortFileEffect,
  resolveDevToolsActivePortPath,
  waitForDevToolsActivePort,
} from "./devtools-active-port";

const sleep = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

const createActivePortDirectory = (): Promise<string> =>
  mkdtemp(path.join(tmpdir(), "odt-electron-devtools-"));

type CapturedPortTimeout = {
  readonly promise: Promise<number | null>;
  readonly fire: () => void;
};

const startPortWaitWithCapturedTimeout = (
  activePortPath: string,
  signal: AbortSignal,
): CapturedPortTimeout => {
  const originalSetTimeout = globalThis.setTimeout;
  let capturedHandler: (() => void) | null = null;
  const captureSetTimeout = (
    handler: () => void,
    delay?: number,
  ): ReturnType<typeof setTimeout> => {
    capturedHandler = handler;
    return originalSetTimeout(handler, delay);
  };
  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    value: captureSetTimeout,
    writable: true,
  });
  const promise = waitForDevToolsActivePort(activePortPath, signal);
  Object.defineProperty(globalThis, "setTimeout", {
    configurable: true,
    value: originalSetTimeout,
    writable: true,
  });
  return {
    fire: () => {
      if (capturedHandler === null) {
        throw new Error("The CDP port wait did not schedule a timeout.");
      }
      capturedHandler();
    },
    promise,
  };
};

describe("Electron DevTools active port file", () => {
  test("resolves the active port file inside the development instance profile", () => {
    expect(resolveDevToolsActivePortPath("electron-0123456789ab")).toEndWith(
      path.join(
        "runtime",
        "dev-instances",
        "electron-0123456789ab",
        "electron-profile",
        "DevToolsActivePort",
      ),
    );
  });

  test("waits for the active port file and returns the bound port", async () => {
    const directory = await createActivePortDirectory();
    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const controller = new AbortController();
      const portPromise = waitForDevToolsActivePort(activePortPath, controller.signal);
      // Electron writes the file after it starts. The macOS directory watcher can start after
      // `watch` returns, so a file that appears at once can come before the watcher.
      await sleep(100);
      await writeFile(activePortPath, "45678\n/devtools/browser/example\n");
      expect(await portPromise).toBe(45_678);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("keeps waiting until Electron finishes writing the active port file", async () => {
    const directory = await createActivePortDirectory();
    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      await writeFile(activePortPath, "4");
      const controller = new AbortController();
      const portPromise = waitForDevToolsActivePort(activePortPath, controller.signal);
      await sleep(20);
      await writeFile(activePortPath, "45678\n/devtools/browser/example\n");
      expect(await portPromise).toBe(45_678);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("resolves the port after a later write when the creation event reads an incomplete file", async () => {
    const directory = await createActivePortDirectory();
    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const controller = new AbortController();
      const portPromise = waitForDevToolsActivePort(activePortPath, controller.signal);
      await sleep(20);
      await writeFile(activePortPath, "4");
      await sleep(50);
      await writeFile(activePortPath, "45678\n/devtools/browser/example\n");
      expect(await portPromise).toBe(45_678);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("stops waiting when the lifecycle aborts the wait", async () => {
    const directory = await createActivePortDirectory();
    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const controller = new AbortController();
      const portPromise = waitForDevToolsActivePort(activePortPath, controller.signal);
      controller.abort();
      expect(await portPromise).toBeNull();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("returns null when the lifecycle passes an aborted signal", async () => {
    const directory = await createActivePortDirectory();
    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const controller = new AbortController();
      controller.abort();
      expect(await waitForDevToolsActivePort(activePortPath, controller.signal)).toBeNull();
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("fails with a recovery step when Electron never writes the active port file", async () => {
    const directory = await createActivePortDirectory();
    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const controller = new AbortController();
      const { fire, promise } = startPortWaitWithCapturedTimeout(activePortPath, controller.signal);
      fire();
      await expect(promise).rejects.toThrow(
        "Electron did not write DevToolsActivePort within 30000ms. Check the Electron startup output, then rerun `bun run electron:dev:cdp`.",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("fails with the last read failure and a recovery step when the active port file stays incomplete", async () => {
    const directory = await createActivePortDirectory();
    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const controller = new AbortController();
      await writeFile(activePortPath, "not-a-port");
      const { fire, promise } = startPortWaitWithCapturedTimeout(activePortPath, controller.signal);
      await sleep(20);
      await writeFile(activePortPath, "still-not-a-port");
      await sleep(50);
      fire();
      await expect(promise).rejects.toThrow(
        "Electron did not write a complete DevToolsActivePort file within 30000ms. Last read failure: Electron wrote an incomplete DevToolsActivePort file. Check the Electron startup output, then rerun `bun run electron:dev:cdp`.",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("fails with a recovery step when the active port file cannot be prepared", async () => {
    const directory = await createActivePortDirectory();
    try {
      const blockerPath = path.join(directory, "blocker");
      await writeFile(blockerPath, "not a directory");
      await expect(
        Effect.runPromise(
          prepareDevToolsActivePortFileEffect(path.join(blockerPath, "DevToolsActivePort")),
        ),
      ).rejects.toThrow(
        "Check the profile directory and its permissions, then rerun `bun run electron:dev:cdp`.",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("fails when the active port file cannot be read", async () => {
    const directory = await createActivePortDirectory();
    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const controller = new AbortController();
      const portPromise = waitForDevToolsActivePort(activePortPath, controller.signal);
      await sleep(20);
      await mkdir(activePortPath);
      await expect(portPromise).rejects.toThrow(`Failed to read ${activePortPath}: EISDIR`);
      await expect(portPromise).rejects.toThrow(
        "Check access to the file, then rerun `bun run electron:dev:cdp`.",
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  test("surfaces a symlink loop at the active port path", async () => {
    const directory = await createActivePortDirectory();
    try {
      const activePortPath = path.join(directory, "DevToolsActivePort");
      const controller = new AbortController();
      const portPromise = waitForDevToolsActivePort(activePortPath, controller.signal);
      await sleep(20);
      symlinkSync("DevToolsActivePort-target", activePortPath);
      symlinkSync("DevToolsActivePort", path.join(directory, "DevToolsActivePort-target"));
      const failingStage = process.platform === "win32" ? "Failed to read" : "Failed to watch";
      await expect(portPromise).rejects.toThrow(`${failingStage} ${activePortPath}`);
      await expect(portPromise).rejects.toThrow("ELOOP");
      await expect(portPromise).rejects.toThrow("then rerun `bun run electron:dev:cdp`.");
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
