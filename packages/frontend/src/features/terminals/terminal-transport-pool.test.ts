import { describe, expect, mock, test } from "bun:test";
import type { TerminalFailure } from "@openducktor/contracts";
import type { TerminalBridge } from "@/lib/shell-bridge";
import { acquireTerminalTransport } from "./terminal-transport-pool";

const settle = async (): Promise<void> => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
};

describe("terminal transport ownership", () => {
  test("shares one connection across shell and output consumers until the final lease ends", async () => {
    const close = mock(async () => {});
    const send = mock(async (_frame: Uint8Array) => {});
    const bridge: TerminalBridge = {
      connect: mock(async (_onFrame, onState) => {
        onState("connected");
        return { close, send };
      }),
    };
    const shell = acquireTerminalTransport(bridge, () => {});
    const output = acquireTerminalTransport(bridge, () => {});
    await settle();
    expect(shell.controller).toBe(output.controller);
    expect(bridge.connect).toHaveBeenCalledTimes(1);
    shell.release();
    expect(close).not.toHaveBeenCalled();
    await output.controller.resize("dev-output", 100, 30);
    expect(send).toHaveBeenCalledTimes(1);
    output.release();
    await settle();
    expect(close).toHaveBeenCalledTimes(1);
    output.release();
    const reopened = acquireTerminalTransport(bridge, () => {});
    await settle();
    expect(reopened.controller).not.toBe(output.controller);
    expect(bridge.connect).toHaveBeenCalledTimes(2);
    reopened.release();
    await settle();
    expect(close).toHaveBeenCalledTimes(2);
  });

  test("reports a shared failure to current and newly mounted consumers", async () => {
    let reportFailure: (failure: TerminalFailure) => void = () => {};
    const bridge: TerminalBridge = {
      connect: async (_onFrame, _onState, onFailure) => {
        reportFailure = onFailure;
        return { close: async () => {}, send: async () => {} };
      },
    };
    const errors: Array<string | null> = [];
    const first = acquireTerminalTransport(bridge, (error) => {
      errors.push(error);
    });
    await settle();
    reportFailure({ code: "protocol_error", message: "Terminal bridge disconnected." });
    const lateErrors: Array<string | null> = [];
    const second = acquireTerminalTransport(bridge, (error) => {
      lateErrors.push(error);
    });
    expect(errors).toEqual([null, "Terminal bridge disconnected."]);
    expect(lateErrors).toEqual(["Terminal bridge disconnected."]);
    first.release();
    second.release();
    await settle();
  });
});
