import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SettingsSnapshot } from "@openducktor/contracts";
import { act, screen } from "@testing-library/react";
import * as appModule from "./App";
import { bootstrapOpenDucktorShell } from "./shell-bootstrap";
import { resolveRootElement } from "./shell-bootstrap-workflow";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";

const REPO_ROOT = resolve(import.meta.dir, "../../..");

const readRepoFile = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), "utf8");

const noRemoteHost = () => {
  throw new Error("This test uses the local host.");
};

afterEach(() => {
  // A pagehide event that does not keep the page in the cache removes the bootstrap listeners.
  window.dispatchEvent(new Event("pagehide"));
  document.body.innerHTML = "";
  document.documentElement.classList.remove("light", "dark");
});

const bootLocalHost = async (readSettings: () => Promise<SettingsSnapshot>): Promise<void> => {
  const rootElement = document.createElement("div");
  document.body.append(rootElement);
  await act(async () => {
    await bootstrapOpenDucktorShell({
      createShellBridge: () =>
        createShellBridgeFixture({ client: { workspaceGetSettingsSnapshot: readSettings } }),
      hosts: { localHost: "web", createRemoteBridge: noRemoteHost },
      rootElement,
    });
  });
};

describe("bootstrapOpenDucktorShell", () => {
  test("applies the theme of the local host before it renders the app", async () => {
    const themes: boolean[] = [];
    const appSpy = spyOn(appModule, "App").mockImplementation(() => {
      themes.push(document.documentElement.classList.contains("dark"));
      return <p>App</p>;
    });
    try {
      await bootLocalHost(async () => createSettingsSnapshotFixture({ theme: "dark" }));

      expect(await screen.findByText("App")).toBeDefined();
      expect(themes[0]).toBe(true);
    } finally {
      appSpy.mockRestore();
    }
  });

  test("reports a settings preload failure and still renders the app", async () => {
    const preloadError = new Error("settings unavailable");
    const appSpy = spyOn(appModule, "App").mockImplementation(() => <p>App</p>);
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    try {
      await bootLocalHost(async () => {
        throw preloadError;
      });

      expect(await screen.findByText("App")).toBeDefined();
      expect(consoleError).toHaveBeenCalledWith(
        "Failed to preload settings snapshot before app bootstrap.",
        preloadError,
      );
    } finally {
      appSpy.mockRestore();
      consoleError.mockRestore();
    }
  });

  test("propagates prepare failures before it reads the root or creates a bridge", async () => {
    const prepareError = new Error("runtime config unavailable");
    const createShellBridge = mock(() => createShellBridgeFixture());

    await expect(
      bootstrapOpenDucktorShell({
        prepare: async () => {
          throw prepareError;
        },
        createShellBridge,
        hosts: { localHost: "web", createRemoteBridge: noRemoteHost },
        rootElement: null,
      }),
    ).rejects.toThrow(prepareError);
    expect(createShellBridge).not.toHaveBeenCalled();
  });
});

describe("resolveRootElement", () => {
  const resolveRoot = (overrides: Partial<Parameters<typeof resolveRootElement>[0]> = {}) =>
    resolveRootElement(
      {
        createShellBridge: createShellBridgeFixture,
        hosts: { localHost: null, createRemoteBridge: noRemoteHost },
        ...overrides,
      },
      (rootId) => document.getElementById(rootId),
    );

  test("fails with an actionable error when the default root is missing", () => {
    expect(() => resolveRoot()).toThrow(
      'OpenDucktor bootstrap root element "#root" was not found. Ensure the shell HTML contains the root element.',
    );
  });

  test("fails with an actionable error when an explicit root is null", () => {
    expect(() => resolveRoot({ rootElement: null })).toThrow(
      "OpenDucktor bootstrap rootElement was explicitly set to null. Omit rootElement to use the shell root lookup, or pass an HTMLElement.",
    );
  });

  test("looks up the root id, also when the root element is explicitly undefined", () => {
    const rootElement = document.createElement("div");
    rootElement.id = "app-root";
    document.body.append(rootElement);

    expect(resolveRoot({ rootId: "app-root" })).toBe(rootElement);
    expect(resolveRoot({ rootElement: undefined, rootId: "app-root" })).toBe(rootElement);
  });
});

describe("shell entrypoints", () => {
  test("the production renderer keeps the crash shell and passes the selected router mode", () => {
    const source = readRepoFile("packages/frontend/src/shell-bootstrap.tsx");

    expect(source).toContain("<StartupSplashLifecycle />");
    expect(source).toContain("<AppCrashShell kanbanLocation={kanbanLocationForRouter(mode)}>");
    expect(source).toContain("<App routerMode={mode} />");
  });

  test("the frontend package root does not export bootstrap internals", () => {
    const source = readRepoFile("packages/frontend/src/index.ts");

    expect(source).toContain("bootstrapOpenDucktorShell");
    expect(source).toContain("OpenDucktorShellBootstrapOptions");
    expect(source).not.toMatch(/resolveRootElement/u);
    expect(source).not.toMatch(/mountOpenDucktorApp|configureShellBridge|getShellBridge|\bApp\b/u);
  });
});
