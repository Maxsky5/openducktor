import { afterEach, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import type { Theme } from "@openducktor/contracts";
import { createDisabledAppUpdateBridge, type ShellBridge } from "./lib/shell-bridge";
import { runOpenDucktorShellBootstrap } from "./shell-bootstrap-workflow";

if (typeof document === "undefined") {
  GlobalRegistrator.register();
}

const REPO_ROOT = resolve(import.meta.dir, "../../..");

const readRepoFile = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), "utf8");

const expectNoManualShellBootstrapSteps = (source: string): void => {
  expect(source).not.toMatch(/\bconfigureShellBridge\b/u);
  expect(source).not.toMatch(/\bmountOpenDucktorApp\b/u);
  expect(source).not.toMatch(/\bdocument\s*\.\s*getElementById\s*\(/u);
};

const createTestShellBridge = (): ShellBridge =>
  ({
    client: {},
    subscribeRunEvents: async () => () => {},
    subscribeDevServerEvents: async () => ({
      transportEpoch: "test:0",
      unsubscribe: () => {},
    }),
    subscribeTaskStream: async () => ({
      subscriptionId: "test-subscription",
      acknowledge: async () => {},
      unsubscribe: () => {},
    }),
    appUpdates: createDisabledAppUpdateBridge({
      status: "disabled",
      currentVersion: "unknown",
      disabledCode: "updater_unavailable",
      disabledReason: "Updates are unavailable in this test shell.",
    }),
    capabilities: {
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    },
    openExternalUrl: async () => {},
    resolveLocalAttachmentPreviewSrc: async () => "asset://preview",
  }) as unknown as ShellBridge;

type BootstrapHarnessOptions = {
  loadSettingsSnapshot?: () => Promise<{ theme: Theme }>;
  configureBridge?: (bridge: ShellBridge) => void;
};

const createBootstrapHarness = (options: BootstrapHarnessOptions = {}) => {
  const events: string[] = [];
  const bridge = createTestShellBridge();
  let configuredBridge: ShellBridge | null = null;
  const reportSettingsPreloadError = mock((_error: unknown) => {
    events.push("reportSettingsPreloadError");
  });
  const renderApp = mock((_rootElement: HTMLElement) => {
    events.push("renderApp");
  });
  const configureBridge = mock((receivedBridge: ShellBridge) => {
    events.push("configureBridge");
    configuredBridge = receivedBridge;
    options.configureBridge?.(receivedBridge);
  });
  const loadSettingsSnapshot = mock(async () => {
    events.push("loadSettingsSnapshot");
    if (configuredBridge !== bridge) {
      throw new Error("settings preload ran before the shell bridge was configured");
    }
    if (options.loadSettingsSnapshot) {
      return options.loadSettingsSnapshot();
    }
    return { theme: "dark" as const };
  });
  const applyTheme = mock((_theme: Theme) => {
    events.push("applyTheme");
  });
  const getRootById = mock((rootId: string) => {
    events.push(`getRootById:${rootId}`);
    return document.getElementById(rootId);
  });

  return {
    bridge,
    bootstrap: (bootstrapOptions: Parameters<typeof runOpenDucktorShellBootstrap>[0]) =>
      runOpenDucktorShellBootstrap(bootstrapOptions, {
        configureBridge,
        getRootById,
        loadSettingsSnapshot,
        applyTheme,
        renderApp,
        reportSettingsPreloadError,
      }),
    deps: {
      applyTheme,
      configureBridge,
      getRootById,
      loadSettingsSnapshot,
      renderApp,
      reportSettingsPreloadError,
    },
    events,
  };
};

afterEach(() => {
  document.body.innerHTML = "";
  document.documentElement.classList.remove("light", "dark");
});

describe("bootstrapOpenDucktorShell", () => {
  test("owns startup ordering from shell readiness through render", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const { bootstrap, bridge, events } = createBootstrapHarness();

    await bootstrap({
      prepare: async () => {
        events.push("prepare");
      },
      createShellBridge: () => {
        events.push("createShellBridge");
        return bridge;
      },
    });

    expect(events).toEqual([
      "prepare",
      "getRootById:root",
      "createShellBridge",
      "configureBridge",
      "loadSettingsSnapshot",
      "applyTheme",
      "renderApp",
    ]);
  });

  test("applies the preloaded theme before rendering", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const { bootstrap, bridge, deps, events } = createBootstrapHarness({
      loadSettingsSnapshot: async () => ({ theme: "light" }),
    });

    await bootstrap({
      createShellBridge: () => bridge,
    });

    expect(deps.applyTheme).toHaveBeenCalledWith("light");
    expect(events.slice(-2)).toEqual(["applyTheme", "renderApp"]);
  });

  test("reports settings preload failures and still renders", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const preloadError = new Error("settings unavailable");
    const { bootstrap, bridge, deps, events } = createBootstrapHarness({
      loadSettingsSnapshot: async () => {
        throw preloadError;
      },
    });

    await bootstrap({
      createShellBridge: () => bridge,
    });

    expect(deps.reportSettingsPreloadError).toHaveBeenCalledWith(preloadError);
    expect(deps.renderApp).toHaveBeenCalledTimes(1);
    expect(events.slice(-3)).toEqual([
      "loadSettingsSnapshot",
      "reportSettingsPreloadError",
      "renderApp",
    ]);
  });

  test("fails with an actionable error when the default root is missing", async () => {
    const { bootstrap, bridge, deps } = createBootstrapHarness();

    await expect(
      bootstrap({
        createShellBridge: () => bridge,
      }),
    ).rejects.toThrow(
      'OpenDucktor bootstrap root element "#root" was not found. Ensure the shell HTML contains the root element.',
    );

    expect(deps.configureBridge).not.toHaveBeenCalled();
    expect(deps.loadSettingsSnapshot).not.toHaveBeenCalled();
    expect(deps.renderApp).not.toHaveBeenCalled();
  });

  test("fails with an actionable error when an explicit root is null", async () => {
    const { bootstrap, bridge, deps } = createBootstrapHarness();

    await expect(
      bootstrap({
        rootElement: null,
        createShellBridge: () => bridge,
      }),
    ).rejects.toThrow(
      "OpenDucktor bootstrap rootElement was explicitly set to null. Omit rootElement to use the shell root lookup, or pass an HTMLElement.",
    );

    expect(deps.configureBridge).not.toHaveBeenCalled();
    expect(deps.loadSettingsSnapshot).not.toHaveBeenCalled();
    expect(deps.renderApp).not.toHaveBeenCalled();
  });

  test("propagates prepare failures before touching bridge or render dependencies", async () => {
    const prepareError = new Error("runtime config unavailable");
    const { bootstrap, bridge, deps, events } = createBootstrapHarness();

    await expect(
      bootstrap({
        prepare: async () => {
          events.push("prepare");
          throw prepareError;
        },
        createShellBridge: () => bridge,
      }),
    ).rejects.toThrow(prepareError);

    expect(events).toEqual(["prepare"]);
    expect(deps.configureBridge).not.toHaveBeenCalled();
    expect(deps.renderApp).not.toHaveBeenCalled();
  });

  test("propagates shell bridge configuration failures before preload and render", async () => {
    document.body.innerHTML = '<div id="root"></div>';
    const configureError = new Error("bridge rejected");
    const { bootstrap, bridge, deps } = createBootstrapHarness({
      configureBridge: () => {
        throw configureError;
      },
    });

    await expect(
      bootstrap({
        createShellBridge: () => bridge,
      }),
    ).rejects.toThrow(configureError);

    expect(deps.loadSettingsSnapshot).not.toHaveBeenCalled();
    expect(deps.renderApp).not.toHaveBeenCalled();
  });

  test("passes the resolved root element to the renderer", async () => {
    document.body.innerHTML = '<div id="app-root"></div>';
    const rootElement = document.getElementById("app-root");
    const { bootstrap, bridge, deps } = createBootstrapHarness();

    await bootstrap({
      rootId: "app-root",
      createShellBridge: () => bridge,
    });

    expect(deps.renderApp).toHaveBeenCalledWith(rootElement);
  });

  test("treats an explicit undefined root as a lookup fallback", async () => {
    document.body.innerHTML = '<div id="app-root"></div>';
    const rootElement = document.getElementById("app-root");
    const { bootstrap, bridge, deps } = createBootstrapHarness();

    await bootstrap({
      rootElement: undefined,
      rootId: "app-root",
      createShellBridge: () => bridge,
    });

    expect(deps.getRootById).toHaveBeenCalledWith("app-root");
    expect(deps.renderApp).toHaveBeenCalledWith(rootElement);
  });
});

describe("shell entrypoints", () => {
  test("Electron delegates shared startup to the frontend bootstrap", () => {
    const source = readRepoFile("apps/electron/src/renderer/main.tsx");

    expect(source).toMatch(
      /import\s*\{\s*bootstrapOpenDucktorShell\s*\}\s*from\s*"@openducktor\/frontend"/u,
    );
    expect(source).toMatch(
      /bootstrapOpenDucktorShell\(\{\s*createShellBridge:\s*createElectronShellBridge,\s*routerMode:\s*"hash",\s*\}\)/u,
    );
    expect(source).toContain('console.error("Critical Electron bootstrap failure", error);');
    expectNoManualShellBootstrapSteps(source);
  });

  test("browser delegates shared startup after supplying runtime config readiness", () => {
    const source = readRepoFile("packages/openducktor-web/src/main.tsx");

    expect(source).toMatch(
      /import\s*\{\s*bootstrapOpenDucktorShell\s*\}\s*from\s*"@openducktor\/frontend"/u,
    );
    expect(source).toContain("bootstrapOpenDucktorShell(");
    expect(source).toContain("prepare: loadBrowserRuntimeConfig");
    expect(source).toContain("createShellBridge: createBrowserShellBridge");
    expect(source).toContain('console.error("Critical browser bootstrap failure", error);');
    expectNoManualShellBootstrapSteps(source);
  });

  test("the production renderer keeps the crash shell and passes the selected router mode", () => {
    const source = readRepoFile("packages/frontend/src/shell-bootstrap.tsx");

    expect(source).toContain("kanbanLocationForRouter");
    expect(source).toContain(
      "<AppCrashShell kanbanLocation={kanbanLocationForRouter(routerMode)}>",
    );
    expect(source).toContain("<App routerMode={routerMode} />");
    expect(source).toContain("routerMode");
  });

  test("electron delegates shared startup to the frontend bootstrap", () => {
    const source = readRepoFile("apps/electron/src/renderer/main.tsx");

    expect(source).toMatch(
      /import\s*\{\s*bootstrapOpenDucktorShell\s*\}\s*from\s*"@openducktor\/frontend"/u,
    );
    expect(source).toContain("createShellBridge: createElectronShellBridge");
    expect(source).toContain('routerMode: "hash"');
    expect(source).toContain('console.error("Critical Electron bootstrap failure", error);');
    expectNoManualShellBootstrapSteps(source);
  });

  test("the frontend package root does not export bootstrap internals", () => {
    const source = readRepoFile("packages/frontend/src/index.ts");

    expect(source).toContain("bootstrapOpenDucktorShell");
    expect(source).toContain("OpenDucktorShellBootstrapOptions");
    expect(source).not.toMatch(/createOpenDucktorShellBootstrap|runOpenDucktorShellBootstrap/u);
    expect(source).not.toMatch(/mountOpenDucktorApp|configureShellBridge|getShellBridge|\bApp\b/u);
  });
});
