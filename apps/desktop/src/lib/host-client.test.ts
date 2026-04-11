import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";

let isBrowserAppMode = false;
let isTauriRuntime = false;
let listenImpl:
  | ((event: string, handler: (event: { payload: unknown }) => void) => unknown)
  | null = null;

describe("host-client", () => {
  beforeEach(() => {
    isBrowserAppMode = false;
    isTauriRuntime = false;
    listenImpl = null;

    mock.module("@/lib/browser-mode", () => ({
      isBrowserAppMode: () => isBrowserAppMode,
      getBrowserBackendUrl: () => "http://127.0.0.1:14327",
    }));

    mock.module("@/lib/runtime", () => ({
      isTauriRuntime: () => isTauriRuntime,
    }));

    mock.module("@tauri-apps/api/event", () => ({
      listen: (event: string, handler: (event: { payload: unknown }) => void) => {
        if (!listenImpl) {
          throw new Error("listenImpl not configured");
        }

        return listenImpl(event, handler);
      },
    }));
  });

  afterEach(async () => {
    await restoreMockedModules([
      ["@/lib/browser-mode", () => import("@/lib/browser-mode")],
      ["@/lib/runtime", () => import("@/lib/runtime")],
      ["@tauri-apps/api/event", () => import("@tauri-apps/api/event")],
    ]);
  });

  test("fails fast when run-event subscriptions are unavailable in the current runtime", async () => {
    const { createHostBridge } = await import("./host-client");

    await expect(createHostBridge().subscribeRunEvents(() => {})).rejects.toThrow(
      "Run-event subscriptions require the desktop shell or browser live mode.",
    );
  });

  test("fails fast when dev-server event subscriptions are unavailable in the current runtime", async () => {
    const { createHostBridge } = await import("./host-client");

    await expect(createHostBridge().subscribeDevServerEvents(() => {})).rejects.toThrow(
      "Dev-server event subscriptions require the desktop shell or browser live mode.",
    );
  });

  test("fails fast when task-event subscriptions are unavailable in the current runtime", async () => {
    const { createHostBridge } = await import("./host-client");

    await expect(createHostBridge().subscribeTaskEvents(() => {})).rejects.toThrow(
      "Task-event subscriptions require the desktop shell or browser live mode.",
    );
  });

  test("subscribes to the Tauri task-event channel", async () => {
    isTauriRuntime = true;
    const listener = mock(() => {});
    let listenedEventName = "";
    let registeredHandler: ((event: { payload: unknown }) => void) | undefined;

    listenImpl = async (event, handler) => {
      listenedEventName = event;
      registeredHandler = handler;
      return () => {};
    };

    const { createHostBridge } = await import("./host-client");
    const unsubscribe = await createHostBridge().subscribeTaskEvents(listener);

    if (!registeredHandler) {
      throw new Error("Expected the Tauri task-event handler to be registered");
    }

    registeredHandler({ payload: { kind: "external_task_created", taskId: "task-1" } });

    expect(listenedEventName).toBe("openducktor://task-event");
    expect(listener).toHaveBeenCalledWith({ kind: "external_task_created", taskId: "task-1" });

    unsubscribe();
  });

  test("passes through batched task update payloads from the Tauri task-event channel", async () => {
    isTauriRuntime = true;
    const listener = mock(() => {});
    let registeredHandler: ((event: { payload: unknown }) => void) | undefined;

    listenImpl = async (_event, handler) => {
      registeredHandler = handler;
      return () => {};
    };

    const { createHostBridge } = await import("./host-client");
    const unsubscribe = await createHostBridge().subscribeTaskEvents(listener);

    if (!registeredHandler) {
      throw new Error("Expected the Tauri task-event handler to be registered");
    }

    registeredHandler({
      payload: {
        kind: "tasks_updated",
        repoPath: "/repo",
        taskIds: ["task-1", "task-2"],
      },
    });

    expect(listener).toHaveBeenCalledWith({
      kind: "tasks_updated",
      repoPath: "/repo",
      taskIds: ["task-1", "task-2"],
    });

    unsubscribe();
  });

  test("normalizes Tauri event cleanup into an idempotent callback", async () => {
    isTauriRuntime = true;
    let cleanupCalls = 0;
    listenImpl = async () => () => {
      cleanupCalls += 1;
    };

    const { createHostBridge } = await import("./host-client");
    const unsubscribe = await createHostBridge().subscribeDevServerEvents(() => {});

    unsubscribe();
    unsubscribe();

    expect(cleanupCalls).toBe(1);
  });

  test("handles rejected async Tauri cleanup without surfacing an unhandled rejection", async () => {
    isTauriRuntime = true;
    const cleanupError = new Error("listener already removed");
    const consoleWarn = spyOn(console, "warn").mockImplementation(() => {});
    listenImpl = async () => async () => {
      throw cleanupError;
    };

    try {
      const { createHostBridge } = await import("./host-client");
      const unsubscribe = await createHostBridge().subscribeRunEvents(() => {});

      unsubscribe();
      await Promise.resolve();

      expect(consoleWarn).toHaveBeenCalledWith(
        "[host-client] Tauri event unsubscribe failed",
        cleanupError,
      );
    } finally {
      consoleWarn.mockRestore();
    }
  });
});
