import { describe, expect, mock, test } from "bun:test";
import { ELECTRON_HOST_SHUTDOWN_MESSAGE } from "../shared/electron-bridge-contract";
import { createElectronHostInvoke } from "./electron-host-invoke";

describe("Electron preload host invoke", () => {
  test("sends the exact host channel and request and returns a success payload", async () => {
    const result = { ok: true as const, value: [] };
    const invoke = mock(async () => ({ status: "success", payload: result }));
    const hostInvoke = createElectronHostInvoke({ invoke });

    await expect(hostInvoke("workspace_list")).resolves.toEqual(result);
    expect(invoke).toHaveBeenCalledWith("openducktor:host-invoke", {
      command: "workspace_list",
    });
  });

  test("rejects shutdown responses with the stable shutdown message", async () => {
    const hostInvoke = createElectronHostInvoke({
      invoke: async () => ({ status: "shutdown" }),
    });

    await expect(hostInvoke("workspace_list")).rejects.toThrow(ELECTRON_HOST_SHUTDOWN_MESSAGE);
  });

  test.each([
    '{"status":"success"}',
    '{"status":"success","payload":{"repoPath":"/workspace"}}',
    '{"status":"shutdown","payload":null}',
  ])("rejects malformed responses with an explicit protocol error", async (response) => {
    const hostInvoke = createElectronHostInvoke({ invoke: async () => JSON.parse(response) });

    await expect(hostInvoke("workspace_list")).rejects.toThrow(
      "Received an invalid host invoke response from the Electron main process.",
    );
  });

  test("preserves void success values for command-specific clients", async () => {
    const result = { ok: true as const, value: undefined };
    const hostInvoke = createElectronHostInvoke({
      invoke: async () => ({ status: "success", payload: result }),
    });

    await expect(hostInvoke("workspace_list")).resolves.toEqual(result);
  });

  test("returns validated host failures unchanged", async () => {
    const result = { ok: false as const, error: { message: "Host command failed" } };
    const hostInvoke = createElectronHostInvoke({
      invoke: async () => ({ status: "success", payload: result }),
    });

    await expect(hostInvoke("workspace_list")).resolves.toEqual(result);
  });

  test("preserves raw IPC invocation failures", async () => {
    const failure = new Error("IPC unavailable");
    const hostInvoke = createElectronHostInvoke({
      invoke: async () => {
        throw failure;
      },
    });

    await expect(hostInvoke("workspace_list")).rejects.toBe(failure);
  });
});
