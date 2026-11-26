import { afterEach, describe, expect, jest, mock, spyOn, test } from "bun:test";
import type { SettingsSnapshot } from "@openducktor/contracts";
import { createHostConnectionStore } from "@openducktor/frontend-core/connection/host-connection-state";
import { HostUnreachableError } from "@openducktor/host-client";
import { act, fireEvent, screen } from "@testing-library/react";
import * as appModule from "./App";
import * as frontend from "./index";
import { resolveRootElement } from "./shell-bootstrap-workflow";
import { createShellBridgeFixture } from "@/test-utils/focused-fixture";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";

const noRemoteHost = () => {
  throw new Error("This test uses the local host.");
};

afterEach(async () => {
  // A pagehide event that does not keep the page in the cache removes the bootstrap listeners.
  await act(async () => window.dispatchEvent(new Event("pagehide")));
  document.body.innerHTML = "";
  document.documentElement.classList.remove("light", "dark");
});

const bootLocalHost = async (
  readSettings: () => Promise<SettingsSnapshot>,
  routerMode?: "hash",
  connectionState = createHostConnectionStore(),
): Promise<void> => {
  const rootElement = document.createElement("div");
  document.body.append(rootElement);
  await act(async () => {
    const options: frontend.OpenDucktorShellBootstrapOptions = {
      createShellBridge: () =>
        createShellBridgeFixture({
          client: { workspaceGetSettingsSnapshot: readSettings },
          bridge: { connectionState },
        }),
      hosts: {
        localHost: "web",
        createRemoteBridge: noRemoteHost,
        confirmRemoteAccess: noRemoteHost,
      },
      rootElement,
    };
    if (routerMode) options.routerMode = routerMode;
    await frontend.bootstrapOpenDucktorShell(options);
  });
};

describe("bootstrapOpenDucktorShell", () => {
  test("applies the host theme before the app renders and dismisses the startup splash", async () => {
    const themes: boolean[] = [];
    const splash = document.createElement("div");
    splash.id = "openducktor-startup";
    document.body.append(splash);
    const appSpy = spyOn(appModule, "App").mockImplementation(() => {
      themes.push(document.documentElement.classList.contains("dark"));
      return <p>App</p>;
    });
    jest.useFakeTimers();
    try {
      await bootLocalHost(async () => createSettingsSnapshotFixture({ theme: "dark" }));

      expect(screen.getByText("App")).toBeTruthy();
      expect(themes[0]).toBe(true);
      expect(splash.isConnected).toBe(true);
      await act(async () => jest.advanceTimersByTime(1_250));
      expect(splash.isConnected).toBe(false);
    } finally {
      jest.useRealTimers();
      appSpy.mockRestore();
    }
  });

  test("a hash-routed shell opens the hash Kanban route after an app crash", async () => {
    const appSpy = spyOn(appModule, "App").mockImplementation(() => {
      throw new Error("App render failed.");
    });
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const replace = spyOn(window.location, "replace").mockImplementation(() => {});
    try {
      await bootLocalHost(async () => createSettingsSnapshotFixture(), "hash");

      fireEvent.click(screen.getByRole("button", { name: "Go to Kanban" }));
      expect(replace).toHaveBeenCalledWith("#/kanban");
      expect(appSpy.mock.calls.at(0)?.[0].routerMode).toBe("hash");
    } finally {
      replace.mockRestore();
      consoleError.mockRestore();
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

  test("renders the app when the settings preload loses the host", async () => {
    const appSpy = spyOn(appModule, "App").mockImplementation(() => <p>App</p>);
    const consoleError = spyOn(console, "error").mockImplementation(() => {});
    const connectionState = createHostConnectionStore();
    try {
      // The app must render, so the connection indicator can explain the lost host.
      await bootLocalHost(
        async () => {
          connectionState.setState("reconnecting");
          throw new HostUnreachableError(new TypeError("Failed to fetch"));
        },
        undefined,
        connectionState,
      );

      expect(await screen.findByText("App")).toBeDefined();
    } finally {
      connectionState.setState("connected");
      appSpy.mockRestore();
      consoleError.mockRestore();
    }
  });

  test("propagates prepare failures before it reads the root or creates a bridge", async () => {
    const prepareError = new Error("runtime config unavailable");
    const createShellBridge = mock(() => createShellBridgeFixture());

    await expect(
      frontend.bootstrapOpenDucktorShell({
        prepare: async () => {
          throw prepareError;
        },
        createShellBridge,
        hosts: {
          localHost: "web",
          createRemoteBridge: noRemoteHost,
          confirmRemoteAccess: noRemoteHost,
        },
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
        hosts: {
          localHost: null,
          createRemoteBridge: noRemoteHost,
          confirmRemoteAccess: noRemoteHost,
        },
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

test("keeps root lookup and the app component private to the frontend package", () => {
  expect("resolveRootElement" in frontend).toBe(false);
  expect("App" in frontend).toBe(false);
});
