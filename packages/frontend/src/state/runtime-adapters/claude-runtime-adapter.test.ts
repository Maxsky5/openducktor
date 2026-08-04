import { describe, expect, mock, test } from "bun:test";
import { CLAUDE_RUNTIME_DESCRIPTOR } from "@openducktor/contracts";
import type { HostClient } from "@openducktor/host-client";
import { createClaudeRuntimeAdapter } from "./claude-runtime-adapter";

describe("createClaudeRuntimeAdapter", () => {
  test("exposes the Claude runtime descriptor", () => {
    const adapter = createClaudeRuntimeAdapter({ hostClient: {} as HostClient });

    expect(adapter.getRuntimeDefinition()).toBe(CLAUDE_RUNTIME_DESCRIPTOR);
  });

  test("delegates stable runtime reads to the Claude host client", async () => {
    const models = { models: [], defaultModelsByProvider: {}, profiles: [] };
    const commands = { commands: [] };
    const history: [] = [];
    const listModels = mock(async () => models);
    const listSlashCommands = mock(async () => commands);
    const loadSessionHistory = mock(async () => history);
    const hostClient = {
      claudeRuntimeListModels: listModels,
      claudeRuntimeListSlashCommands: listSlashCommands,
      claudeRuntimeLoadSessionHistory: loadSessionHistory,
    } as unknown as HostClient;
    const adapter = createClaudeRuntimeAdapter({ hostClient });
    const runtimeRef = { repoPath: "/repo", runtimeKind: "claude" as const };
    const workingDirectoryRef = { ...runtimeRef, workingDirectory: "/repo/worktree" };
    const sessionRef = {
      ...workingDirectoryRef,
      externalSessionId: "session-1",
      runtimePolicy: { kind: "claude" as const },
      sessionScope: { kind: "workflow" as const, taskId: "task-1", role: "build" as const },
    };

    await expect(adapter.listAvailableModels(runtimeRef)).resolves.toBe(models);
    await expect(adapter.listAvailableSlashCommands(workingDirectoryRef)).resolves.toBe(commands);
    await expect(adapter.loadSessionHistory(sessionRef)).resolves.toBe(history);
    expect(listModels).toHaveBeenCalledWith(runtimeRef);
    expect(listSlashCommands).toHaveBeenCalledWith(workingDirectoryRef);
    expect(loadSessionHistory).toHaveBeenCalledWith(sessionRef);
  });
});
