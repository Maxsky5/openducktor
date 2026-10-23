import { expect, test } from "bun:test";
import type { HostCommandName, WorkspaceSession } from "@openducktor/contracts";
import { createHostClient } from "./index";

test("fork commands return committed records with synchronization warnings", async () => {
  const runtimeSession = {
    externalSessionId: "child",
    runtimeKind: "codex" as const,
    workingDirectory: "/repo",
    startedAt: "2026-10-22T10:00:00.000Z",
    status: "idle" as const,
  };
  const workflowRecord = {
    externalSessionId: "child",
    runtimeKind: "codex" as const,
    workingDirectory: "/repo",
    startedAt: runtimeSession.startedAt,
    role: "build" as const,
    selectedModel: null,
  };
  const workspaceRecord: WorkspaceSession = {
    id: "fork",
    runtimeKind: "codex",
    externalSessionId: "child",
    executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: null,
    manualTitle: "Chat (fork)",
    targetBranch: null,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: null,
  };
  const calls: Array<{ command: HostCommandName; args: unknown }> = [];
  let malformed = false;
  const client = createHostClient(async (command, args, schema) => {
    calls.push({ command, args });
    return schema.parse({
      record: command === "workspace_session_fork" ? workspaceRecord : workflowRecord,
      runtimeSession: malformed ? null : runtimeSession,
      syncWarning: "The session was saved. Reconnect to refresh the session list.",
    });
  });
  const workflowInput = {
    repoPath: "/repo",
    runtimeKind: "codex" as const,
    workingDirectory: "/repo",
    externalSessionId: "source",
    sessionScope: { kind: "workflow" as const, taskId: "task", role: "build" as const },
    forkPoint: { messageId: "reply" },
  };
  const workspaceInput = {
    workspaceId: "workspace",
    sessionId: "source",
    forkPoint: { messageId: "reply" },
    destination: { kind: "same_folder" as const },
  };
  expect(await client.agentSessionWorkflowFork(workflowInput)).toMatchObject({
    record: workflowRecord,
    runtimeSession,
    syncWarning: expect.stringContaining("session was saved"),
  });
  expect(await client.workspaceSessionFork(workspaceInput)).toMatchObject({
    record: workspaceRecord,
    runtimeSession,
  });
  expect(calls).toEqual([
    { command: "agent_session_workflow_fork", args: workflowInput },
    { command: "workspace_session_fork", args: workspaceInput },
  ]);
  malformed = true;
  await expect(client.agentSessionWorkflowFork(workflowInput)).rejects.toThrow();
  await expect(client.workspaceSessionFork(workspaceInput)).rejects.toThrow();
});
