import { describe, expect, mock, test } from "bun:test";
import { registerElectronHostInvokeHandler } from "./electron-host-invoke-handler";

const request = {
  command: "workspace_get_context",
  args: { repoPath: "/workspace" },
};

type ElectronHostInvokeHandler = (event: unknown, request: unknown) => Promise<unknown>;

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
  reject(reason: unknown): void;
  resolve(value: Value): void;
} => {
  let reject: (reason: unknown) => void = () => {};
  let resolve: (value: Value) => void = () => {};
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
};

describe("Electron host invoke IPC handler", () => {
  test("registers the host channel and wraps a normal host result", async () => {
    const result = { repoPath: "/workspace" };
    const invoke = mock(async () => result);
    const registered = createRegisteredHandler();

    registerElectronHostInvokeHandler(registered.ipcMain, {
      isHostShutdownStarted: () => false,
      invoke,
    });

    expect(registered.channel).toBe("openducktor:host-invoke");
    await expect(registered.handler({}, request)).resolves.toEqual({
      status: "success",
      payload: result,
    });
    expect(invoke).toHaveBeenCalledWith("workspace_get_context", request.args);
  });

  test("checks shutdown when a request arrives and does not invoke the router", async () => {
    const invoke = mock(async () => ({ repoPath: "/workspace" }));
    let shutdownStarted = false;
    const registered = createRegisteredHandler();

    registerElectronHostInvokeHandler(registered.ipcMain, {
      isHostShutdownStarted: () => shutdownStarted,
      invoke,
    });
    shutdownStarted = true;

    await expect(registered.handler({}, null)).resolves.toEqual({ status: "shutdown" });
    expect(invoke).not.toHaveBeenCalled();
  });

  test.each([
    ["null", null, "request", "Electron host invoke request must be an object."],
    ["undefined", undefined, "request", "Electron host invoke request must be an object."],
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
  ] as const)("rejects %s without invoking the router", async (_case, invalidRequest, field, message) => {
    const invoke = mock(async () => ({ repoPath: "/workspace" }));
    const registered = createRegisteredHandler();

    registerElectronHostInvokeHandler(registered.ipcMain, {
      isHostShutdownStarted: () => false,
      invoke,
    });

    await expect(registered.handler({}, invalidRequest)).rejects.toMatchObject({
      _tag: "ElectronValidationError",
      operation: "electron.ipc.host-invoke.validate",
      field,
      message,
    });
    expect(invoke).not.toHaveBeenCalled();
  });

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

    await expect(registered.handler({}, request)).rejects.toBe(failure);
  });

  test("keeps an admitted pending invocation's success outcome after shutdown starts", async () => {
    const deferred = createDeferred<{ repoPath: string }>();
    const invoke = mock(() => deferred.promise);
    let shutdownStarted = false;
    const registered = createRegisteredHandler();

    registerElectronHostInvokeHandler(registered.ipcMain, {
      isHostShutdownStarted: () => shutdownStarted,
      invoke,
    });

    const response = registered.handler({}, request);
    expect(invoke).toHaveBeenCalledWith("workspace_get_context", request.args);
    shutdownStarted = true;
    deferred.resolve({ repoPath: "/workspace" });

    await expect(response).resolves.toEqual({
      status: "success",
      payload: { repoPath: "/workspace" },
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

    const response = registered.handler({}, request);
    expect(invoke).toHaveBeenCalledWith("workspace_get_context", request.args);
    shutdownStarted = true;
    deferred.reject(failure);

    await expect(response).rejects.toBe(failure);
  });
});
