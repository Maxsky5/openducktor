import { describe, expect, test } from "bun:test";
import { HostInvokeError } from "./invoke-utils";
import { HostTerminalClient, HostTerminalClientError } from "./terminal-client";

const summary = {
  terminalId: "terminal-1",
  label: "Shell 1",
  context: { taskId: "task-1" },
  initialWorkingDir: "/repo/worktree",
  createdAt: "2026-07-12T00:00:00.000Z",
  lifecycle: "running",
  exit: null,
};

describe("HostTerminalClient", () => {
  test("validates create request and response", async () => {
    const calls: unknown[] = [];
    const client = new HostTerminalClient(async (command, input) => {
      calls.push({ command, input });
      return { ref: { terminalId: "terminal-1" }, summary };
    });
    await expect(
      client.terminalCreate({ workingDir: "/repo/worktree", context: { taskId: "task-1" } }),
    ).resolves.toEqual({ ref: { terminalId: "terminal-1" }, summary });
    expect(calls).toEqual([
      {
        command: "terminal_create",
        input: { workingDir: "/repo/worktree", context: { taskId: "task-1" } },
      },
    ]);
  });

  test("validates list, path-input, and close payloads", async () => {
    const client = new HostTerminalClient(async (command) => {
      if (command === "terminal_list") return { hostInstanceId: "host-1", terminals: [summary] };
      if (command === "terminal_prepare_path_input") return { text: "'/tmp/image.png'" };
      if (command === "terminal_close") return { closed: true };
      throw new Error(`Unexpected ${command}`);
    });
    await expect(
      client.terminalList({ filter: { kind: "task", taskId: "task-1" } }),
    ).resolves.toEqual({
      hostInstanceId: "host-1",
      terminals: [summary],
    });
    await expect(
      client.terminalPreparePathInput({ terminalId: "terminal-1", paths: ["/tmp/image.png"] }),
    ).resolves.toEqual({ text: "'/tmp/image.png'" });
    await expect(
      client.terminalClose({ terminalId: "terminal-1", confirmTerminate: true }),
    ).resolves.toEqual({ closed: true });
  });

  test("preserves a typed close-confirmation outcome", async () => {
    const client = new HostTerminalClient(async () => ({
      closed: false,
      confirmationRequired: true,
    }));

    await expect(
      client.terminalClose({ terminalId: "terminal-1", confirmTerminate: false }),
    ).resolves.toEqual({ closed: false, confirmationRequired: true });
  });

  test("rejects malformed host responses", async () => {
    const client = new HostTerminalClient(async () => ({ terminals: [] }));
    await expect(client.terminalList({ filter: { kind: "all" } })).rejects.toThrow();
  });

  test("preserves structured terminal failures without parsing their message", async () => {
    const client = new HostTerminalClient(async () => {
      throw new HostInvokeError("This copy can change without affecting behavior.", {
        kind: "terminal",
        terminalFailure: {
          code: "unsupported_runtime",
          message: "Interactive terminals are unavailable in this runtime.",
        },
      });
    });

    const result = await client
      .terminalCreate({ workingDir: "/repo/worktree", context: { taskId: "task-1" } })
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error }),
      );

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected terminalCreate to reject.");
    expect(result.error).toBeInstanceOf(HostTerminalClientError);
    expect(result.error).toMatchObject({
      code: "unsupported_runtime",
      message: "Interactive terminals are unavailable in this runtime.",
    });
  });
});
