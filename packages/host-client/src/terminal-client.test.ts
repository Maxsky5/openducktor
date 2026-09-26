import { describe, expect, test } from "bun:test";
import type { HostCommandArgs, HostCommandName } from "@openducktor/contracts";
import { createHostClient } from "./index";

const summary = {
  terminalId: "terminal-1",
  label: "Shell 1",
  context: { repoPath: "/repo", taskId: "task-1" },
  initialWorkingDir: "/repo/worktree",
  createdAt: "2026-07-12T00:00:00.000Z",
  lifecycle: "running",
  exit: null,
};

describe("host client terminal operations", () => {
  test("validates create request and response", async () => {
    const calls: Array<{
      command: HostCommandName;
      input: Exclude<HostCommandArgs, undefined> | undefined;
    }> = [];
    const client = createHostClient(async (command, input, resultSchema) => {
      calls.push({ command, input });
      return resultSchema.parse({ ref: { terminalId: "terminal-1" }, summary });
    });
    await expect(
      client.terminalCreate({
        workingDir: "/repo/worktree",
        context: { repoPath: "/repo", taskId: "task-1" },
      }),
    ).resolves.toEqual({ ref: { terminalId: "terminal-1" }, summary });
    expect(calls).toEqual([
      {
        command: "terminal_create",
        input: {
          workingDir: "/repo/worktree",
          context: { repoPath: "/repo", taskId: "task-1" },
        },
      },
    ]);
    await expect(
      client.terminalCreate({
        workingDir: " ",
        context: { repoPath: "/repo", taskId: "task-1" },
      }),
    ).rejects.toThrow();
    expect(calls).toHaveLength(1);

    const malformedClient = createHostClient(async (_command, _input, resultSchema) =>
      resultSchema.parse({ ref: { terminalId: "terminal-1" } }),
    );
    await expect(
      malformedClient.terminalCreate({ workingDir: "/repo/worktree", context: {} }),
    ).rejects.toThrow();
  });

  test("routes list, path input, and close commands", async () => {
    const client = createHostClient(async (command, _input, resultSchema) => {
      if (command === "terminal_list") {
        return resultSchema.parse({ hostInstanceId: "host-1", terminals: [summary] });
      }
      if (command === "terminal_prepare_path_input") {
        return resultSchema.parse({ text: "'/tmp/image.png'" });
      }
      if (command === "terminal_close") return resultSchema.parse({ closed: true });
      throw new Error(`Unexpected ${command}`);
    });
    await expect(
      client.terminalList({ filter: { kind: "task", repoPath: "/repo", taskId: "task-1" } }),
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
    const calls: Array<{
      command: HostCommandName;
      input: Exclude<HostCommandArgs, undefined> | undefined;
    }> = [];
    const client = createHostClient(async (command, input, resultSchema) => {
      calls.push({ command, input });
      return resultSchema.parse({ closed: false, confirmationRequired: true });
    });

    await expect(
      client.terminalClose({ terminalId: "terminal-1", confirmTerminate: false }),
    ).resolves.toEqual({ closed: false, confirmationRequired: true });
    expect(calls).toEqual([
      {
        command: "terminal_close",
        input: { terminalId: "terminal-1", confirmTerminate: false },
      },
    ]);
  });

  test("rejects malformed host responses", async () => {
    const client = createHostClient(async (_command, _input, resultSchema) =>
      resultSchema.parse({ terminals: [] }),
    );
    await expect(client.terminalList({ filter: { kind: "all" } })).rejects.toThrow();
  });
});
