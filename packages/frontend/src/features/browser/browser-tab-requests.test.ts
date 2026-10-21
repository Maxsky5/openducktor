import { describe, expect, test } from "bun:test";
import type { BrowserEngineState } from "@openducktor/contracts";
import { HostBrowserClientError } from "@openducktor/host-client";
import { browserTabIdFixture } from "@/test-utils/session-panel-fixtures";
import { createBrowserTabRequests } from "./browser-tab-requests";
import { createBrowserTabsStore } from "@openducktor/frontend-core/browser/browser-tabs-store";

const owner = { kind: "task" as const, workspaceId: "w", taskId: "t" };

const createHarness = async (engine: BrowserEngineState, hostPage = true) => {
  let emit: (state: BrowserEngineState) => void = () => {};
  const store = createBrowserTabsStore({
    shows: () => true,
    readTabs: async () => [],
    readEngine: async () => engine,
    subscribe: async (listener) => {
      emit = (state) => listener({ type: "engine_changed", state });
      return () => {};
    },
  });
  await store.start();
  const calls: string[] = [];
  let closeFailure: Error | null = null;
  const requests = createBrowserTabRequests(store, {
    hostPage,
    open: async ({ tabId }) => {
      calls.push(`open:${tabId}`);
    },
    start: async (tabId) => {
      calls.push(`start:${tabId}`);
    },
    close: async (tabId) => {
      calls.push(`close:${tabId}`);
      if (closeFailure) throw closeFailure;
    },
  });
  return {
    requests,
    calls,
    makeReady: () => emit({ kind: "ready", engine: "chrome_for_testing" }),
    failClose: (error: Error) => {
      closeFailure = error;
    },
  };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("browser tab requests of frame tabs", () => {
  test("opens a tab with no host page at once, also while the browser is not installed", async () => {
    const harness = await createHarness(
      { kind: "not_installed", version: "1", downloadBytes: 10 },
      false,
    );

    await harness.requests.open({ owner, tabId: browserTabIdFixture(1), address: null });

    expect(harness.calls).toEqual([`open:${browserTabIdFixture(1)}`]);
  });
});

describe("browser tab requests", () => {
  test("opens at once when the engine is ready", async () => {
    const harness = await createHarness({
      kind: "ready",
      engine: "chrome_for_testing",
    });

    await harness.requests.open({ owner, tabId: browserTabIdFixture(1), address: null });

    expect(harness.calls).toEqual([`open:${browserTabIdFixture(1)}`]);
  });

  test("holds opens and starts until the browser is installed", async () => {
    const harness = await createHarness({ kind: "not_installed", version: "1", downloadBytes: 1 });
    const opened = harness.requests.open({ owner, tabId: browserTabIdFixture(1), address: null });
    const started = harness.requests.start(browserTabIdFixture(2));
    await flush();
    expect(harness.calls).toEqual([]);

    harness.makeReady();
    await Promise.all([opened, started]);

    expect(harness.calls).toEqual([
      `open:${browserTabIdFixture(1)}`,
      `start:${browserTabIdFixture(2)}`,
    ]);
  });

  test("a close cancels an open that still waits and runs after it", async () => {
    const harness = await createHarness({ kind: "not_installed", version: "1", downloadBytes: 1 });
    const opened = harness.requests.open({ owner, tabId: browserTabIdFixture(1), address: null });
    const closed = harness.requests.close(browserTabIdFixture(1));

    harness.makeReady();
    await Promise.all([opened, closed]);

    expect(harness.calls).toEqual([`close:${browserTabIdFixture(1)}`]);
  });

  test("treats a tab that the host no longer has as closed", async () => {
    const harness = await createHarness({
      kind: "ready",
      engine: "chrome_for_testing",
    });
    harness.failClose(
      new HostBrowserClientError(
        { code: "browser_tab_not_found", message: "This browser tab no longer exists." },
        null,
      ),
    );

    await harness.requests.close(browserTabIdFixture(1));

    expect(harness.calls).toEqual([`close:${browserTabIdFixture(1)}`]);
  });

  test("reports other close failures", async () => {
    const harness = await createHarness({
      kind: "ready",
      engine: "chrome_for_testing",
    });
    harness.failClose(new Error("Host stopped."));

    const error = await harness.requests.close(browserTabIdFixture(1)).then(
      () => null,
      (cause: Error) => cause,
    );

    expect(error?.message).toBe("Host stopped.");
  });
});
