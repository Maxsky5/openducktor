import { describe, expect, mock, test } from "bun:test";
import type { IpcMainInvokeEvent } from "electron";
import { registerElectronHostInvokeHandler } from "./electron-host-invoke-handler";

// SAFETY: these tests only exercise request handling; handlers never read the event.
const ipcMainInvokeEvent = {} as IpcMainInvokeEvent;

const request = {
  command: "workspace_list",
  args: { repoPath: "/workspace" },
};

type ElectronHostInvokeHandler = (event: IpcMainInvokeEvent, request: unknown) => Promise<unknown>;

const createRegisteredHandler = (): {
  channel: string | undefined;
  handler: ElectronHostInvokeHandler;
  ipcMain: {
    handle(channel: string, handler: ElectronHostInvokeHandler): void;
  };
} => {
  let channel: string | undefined;
  let handler: ElectronHostInvokeHandler | undefined;

  return {
    get channel() {
      return channel;
    },
    get handler() {
      if (!handler) {
        throw new Error("Expected Electron host invoke handler to be registered.");
      }
      return handler;
    },
    ipcMain: {
      handle(registeredChannel, registeredHandler) {
        channel = registeredChannel;
        handler = registeredHandler;
      },
    },
  };
};

const createDeferred = <Value>(): {
  promise: Promise<Value>;
  reject(cause: unknown): void;
  resolve(value: Value): void;
} => {
  let reject: (cause: unknown) => void = () => {};
  let resolve: (value: Value) => void = () => {};
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
};

describe("Electron host invoke IPC handler", () => {
  test("registers the host channel and wraps a normal host result", async () => {
    const result = [];
    const invoke = mock(async () => result);
    const registered = createRegisteredHandler();

    registerElectronHostInvokeHandler(registered.ipcMain, {
      isHostShutdownStarted: () => false,
      invoke,
    });

    expect(registered.channel).toBe("openducktor:host-invoke");
    await expect(registered.handler(ipcMainInvokeEvent, request)).resolves.toEqual({
      status: "success",
      payload: result,
    });
    expect(invoke).toHaveBeenCalledWith("workspace_list", request.args);
  });

  test("checks shutdown when a request arrives and does not invoke the router", async () => {
    const invoke = mock(async () => []);
    let shutdownStarted = false;
    const registered = createRegisteredHandler();

    registerElectronHostInvokeHandler(registered.ipcMain, {
      isHostShutdownStarted: () => shutdownStarted,
      invoke,
    });
    shutdownStarted = true;

    await expect(registered.handler(ipcMainInvokeEvent, null)).resolves.toEqual({
      status: "shutdown",
    });
    expect(invoke).not.toHaveBeenCalled();
  });

  test.each([
    ["null", null, "request", "Electron host invoke request must be an object."],
    ["undefined", undefined, "request", "Electron host invoke request must be an object."],
    ["a Date", new Date(), "request", "Electron host invoke request must be an object."],
    [
      "a null command",
      { command: null },
      "command",
      "Electron host invoke command must be a string.",
    ],
    [
      "null arguments",
      { command: "workspace_list", args: null },
      "args",
      "Electron host invoke arguments must be an object when provided.",
    ],
  ] as const)(
    "rejects %s without invoking the router",
    async (_case, invalidRequest, field, message) => {
      const invoke = mock(async () => []);
      const registered = createRegisteredHandler();

      registerElectronHostInvokeHandler(registered.ipcMain, {
        isHostShutdownStarted: () => false,
        invoke,
      });

      await expect(registered.handler(ipcMainInvokeEvent, invalidRequest)).rejects.toMatchObject({
        _tag: "ElectronValidationError",
        operation: "electron.ipc.host-invoke.validate",
        field,
        message,
      });
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  test("preserves genuine host failures", async () => {
    const failure = new Error("host failure");
    const invoke = mock(async () => {
      throw failure;
    });
    const registered = createRegisteredHandler();

    registerElectronHostInvokeHandler(registered.ipcMain, {
      isHostShutdownStarted: () => false,
      invoke,
    });

    await expect(registered.handler(ipcMainInvokeEvent, request)).rejects.toBe(failure);
  });

  test("returns a typed failure when a successful command result is malformed", async () => {
    const registered = createRegisteredHandler();

    registerElectronHostInvokeHandler(registered.ipcMain, {
      isHostShutdownStarted: () => false,
      invoke: async () => ({ ok: true, value: { runtimeId: "runtime-1" } }),
    });

    await expect(registered.handler(ipcMainInvokeEvent, request)).resolves.toEqual({
      status: "success",
      payload: {
        ok: false,
        error: { message: "Host command 'workspace_list' returned an invalid response." },
      },
    });
  });

  test("keeps an admitted pending invocation's success outcome after shutdown starts", async () => {
    const deferred = createDeferred<[]>();
    const invoke = mock(() => deferred.promise);
    let shutdownStarted = false;
    const registered = createRegisteredHandler();

    registerElectronHostInvokeHandler(registered.ipcMain, {
      isHostShutdownStarted: () => shutdownStarted,
      invoke,
    });

    const response = registered.handler(ipcMainInvokeEvent, request);
    expect(invoke).toHaveBeenCalledWith("workspace_list", request.args);
    shutdownStarted = true;
    deferred.resolve([]);

    await expect(response).resolves.toEqual({
      status: "success",
      payload: [],
    });
  });

  test("keeps an admitted pending invocation's rejection after shutdown starts", async () => {
    const deferred = createDeferred<never>();
    const failure = new Error("host failure");
    const invoke = mock(() => deferred.promise);
    let shutdownStarted = false;
    const registered = createRegisteredHandler();

    registerElectronHostInvokeHandler(registered.ipcMain, {
      isHostShutdownStarted: () => shutdownStarted,
      invoke,
    });

    const response = registered.handler(ipcMainInvokeEvent, request);
    expect(invoke).toHaveBeenCalledWith("workspace_list", request.args);
    shutdownStarted = true;
    deferred.reject(failure);

    await expect(response).rejects.toBe(failure);
  });
});
