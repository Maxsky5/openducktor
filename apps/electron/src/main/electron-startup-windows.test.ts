import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  createDataUpgradeWindowHook,
  createElectronStartupWindows,
  renderDataUpgradeHtml,
  renderStartupErrorHtml,
  type StartupWindow,
  startupWindowUrl,
} from "./electron-startup-windows";

const createFakeWindow = (steps: string[], loadFailure?: Error) => {
  let destroyed = false;
  return {
    destroy: () => {
      destroyed = true;
      steps.push("destroy");
    },
    isDestroyed: () => destroyed,
    loadURL: async (url: string) => {
      steps.push(url === startupWindowUrl(renderDataUpgradeHtml()) ? "load-upgrade" : url);
      if (loadFailure) throw loadFailure;
    },
  };
};

const deferred = () => {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe("data upgrade window", () => {
  test("lets the import start before Electron is ready, and closes when the import finishes", async () => {
    const steps: string[] = [];
    const ready = deferred();
    const loaded = deferred();
    const hook = createDataUpgradeWindowHook({
      openWindow: () => {
        steps.push("open");
        const window = createFakeWindow(steps);
        return { ...window, loadURL: (url) => window.loadURL(url).then(loaded.resolve) };
      },
      reportFailure: (message) => steps.push(`report: ${message}`),
      whenReady: () => ready.promise,
    });

    await Effect.runPromise(hook("started"));
    steps.push("import");
    ready.resolve();
    await loaded.promise;
    await Effect.runPromise(hook("finished"));

    expect(steps).toEqual(["import", "open", "load-upgrade", "destroy"]);
  });

  test("does not open the window when the import finishes before Electron is ready", async () => {
    const steps: string[] = [];
    const ready = deferred();
    const hook = createDataUpgradeWindowHook({
      openWindow: () => {
        steps.push("open");
        return createFakeWindow(steps);
      },
      reportFailure: (message) => steps.push(`report: ${message}`),
      whenReady: () => ready.promise,
    });

    await Effect.runPromise(hook("started"));
    await Effect.runPromise(hook("finished"));
    ready.resolve();
    // A macrotask runs after every pending promise job of the hook.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(steps).toEqual([]);
  });

  test("reports a window failure without failing the import", async () => {
    const loadFailure = new Error("load failed");
    const steps: string[] = [];
    const reported = deferred();
    const reports: unknown[] = [];
    const hook = createDataUpgradeWindowHook({
      openWindow: () => createFakeWindow(steps, loadFailure),
      reportFailure: (message, cause) => {
        reports.push({ message, cause });
        reported.resolve();
      },
      whenReady: async () => {},
    });

    await Effect.runPromise(hook("started"));
    await reported.promise;
    await Effect.runPromise(hook("finished"));

    expect(reports).toEqual([
      { message: "OpenDucktor could not show the data upgrade window.", cause: loadFailure },
    ]);
    expect(steps).toEqual(["load-upgrade", "destroy"]);
  });

  test("tells the user to wait in light and dark themes", () => {
    const html = renderDataUpgradeHtml();

    expect(html).toContain("Upgrading OpenDucktor data");
    expect(html).toContain("Do not quit OpenDucktor.");
    expect(html).toContain("prefers-color-scheme: dark");
    expect(html).toContain("prefers-reduced-motion: reduce");
  });
});

describe("startup error window", () => {
  const createErrorWindows = () => {
    const steps: string[] = [];
    const closedListeners: Array<(event: { preventDefault(): void }) => void> = [];
    const window: StartupWindow = {
      destroy: () => {},
      focus: () => steps.push("focus"),
      isDestroyed: () => false,
      loadURL: async (url) => {
        steps.push(
          url === startupWindowUrl(renderStartupErrorHtml("Fix config.json", "/logs"))
            ? "load-error"
            : url,
        );
      },
      on: (event: "close" | "closed", listener: (event: { preventDefault(): void }) => void) => {
        if (event === "closed") closedListeners.push(listener);
      },
      webContents: { setWindowOpenHandler: () => {}, on: () => {} },
    };
    const windows = createElectronStartupWindows({
      createWindow: () => {
        steps.push("open");
        return window;
      },
      exitApp: (exitCode) => steps.push(`exit ${exitCode}`),
      isHostShutdownComplete: () => false,
      resolveLogDirectory: () => "/logs",
      shouldUseDarkColors: () => false,
      whenReady: async () => {},
    });
    const close = () => {
      for (const listener of closedListeners.splice(0)) listener({ preventDefault: () => {} });
    };
    return { close, steps, windows };
  };

  test("shows one window and exits with a failure status when the user closes it", async () => {
    const { close, steps, windows } = createErrorWindows();

    await windows.showStartupError("Fix config.json");
    await windows.showStartupError("Fix config.json");
    close();

    expect(steps).toEqual(["open", "load-error", "focus", "exit 1"]);
  });
});
