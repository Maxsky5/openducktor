import { expect, test } from "bun:test";
import type { HostCommandName, WorkspaceSession } from "@openducktor/contracts";
import { createHostClient } from "./index";

const makeDraft = (): WorkspaceSession => ({
  id: "chat",
  runtimeKind: "codex",
  externalSessionId: null,
  executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
  roleSnapshot: null,
  selectedModel: null,
  generatedTitle: null,
  manualTitle: null,
  createdAt: 1000,
  updatedAt: 1000,
  archivedAt: null,
});

test("creates a draft, starts it, and saves draft models through separate host commands", async () => {
  const draft = makeDraft();
  const selectedModel = { runtimeKind: "codex" as const, providerId: "openai", modelId: "model" };
  const calls: Array<{ command: HostCommandName; args: unknown }> = [];
  const client = createHostClient(async (command, args, schema) => {
    calls.push({ command, args });
    if (command === "workspace_session_create") return schema.parse({ session: draft });
    if (command === "workspace_session_start")
      return schema.parse({
        session: { ...draft, externalSessionId: "native" },
        runtimeSession: {
          runtimeKind: "codex",
          externalSessionId: "native",
          workingDirectory: "/repo",
          startedAt: "1970-01-01T00:00:01.000Z",
          status: "idle",
        },
      });
    if (command === "workspace_session_set_draft_model")
      return schema.parse({ ...draft, selectedModel, updatedAt: 1001 });
    throw new Error(`Unexpected command: ${command}`);
  });
  const createInput = {
    workspaceId: "workspace",
    runtimeKind: "codex" as const,
    selectedModel: null,
    customAgentRoleId: null,
    location: "local_repo_root" as const,
    manualTitle: null,
  };
  const created = await client.workspaceSessionCreate(createInput);
  expect(created.session.id).toBe("chat");
  const ref = { workspaceId: "workspace", sessionId: "chat" };
  const started = await client.workspaceSessionStart(ref);
  expect(started.session.externalSessionId).toBe("native");
  expect(started.runtimeSession).toMatchObject({
    externalSessionId: "native",
    startedAt: "1970-01-01T00:00:01.000Z",
    status: "idle",
  });
  expect(await client.workspaceSessionSetDraftModel({ ...ref, selectedModel })).toMatchObject({
    selectedModel,
    updatedAt: 1001,
  });
  expect(calls).toEqual([
    { command: "workspace_session_create", args: createInput },
    { command: "workspace_session_start", args: ref },
    { command: "workspace_session_set_draft_model", args: { ...ref, selectedModel } },
  ]);
});

test("rejects a malformed start response", async () => {
  const calls: HostCommandName[] = [];
  const client = createHostClient(async (command, _args, schema) => {
    calls.push(command);
    return schema.parse({ session: makeDraft() });
  });
  await expect(
    client.workspaceSessionStart({ workspaceId: "workspace", sessionId: "chat" }),
  ).rejects.toThrow();
  expect(calls).toEqual(["workspace_session_start"]);
});

test("reads archive impact and forwards explicit worktree removal through the host boundary", async () => {
  const calls: Array<{ command: HostCommandName; args: unknown }> = [];
  const preview = { branchName: "feature/chat", worktreeExists: true, hasUncommittedChanges: true };
  const archived: WorkspaceSession = {
    id: "chat",
    runtimeKind: "codex",
    externalSessionId: "native",
    executionTarget: {
      kind: "local_worktree",
      workingDirectory: "/worktrees/chat",
      branchName: "feature/chat",
      worktreeState: "removed",
    },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: null,
    manualTitle: null,
    createdAt: 1,
    updatedAt: 1,
    archivedAt: 2,
  };
  const client = createHostClient(async (command, args, schema) => {
    calls.push({ command, args });
    return schema.parse(command === "workspace_session_archive_preview" ? preview : archived);
  });
  const ref = { workspaceId: "workspace", sessionId: "chat" };
  expect(await client.workspaceSessionArchivePreview(ref)).toEqual(preview);
  expect(
    await client.workspaceSessionArchive({ ...ref, confirmStop: true, removeWorktree: true }),
  ).toEqual(archived);
  expect(calls).toEqual([
    { command: "workspace_session_archive_preview", args: ref },
    {
      command: "workspace_session_archive",
      args: { ...ref, confirmStop: true, removeWorktree: true },
    },
  ]);
});
