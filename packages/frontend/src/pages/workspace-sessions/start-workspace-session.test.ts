import { expect, test } from "bun:test";
import type { WorkspaceSessionStartResult } from "@openducktor/contracts";
import { createAgentSessionsStore } from "@/state/agent-sessions-store";
import { createAgentSessionFixture } from "@/test-utils/shared-test-fixtures";
import { startWorkspaceSession } from "./start-workspace-session";

const startedResult = (): WorkspaceSessionStartResult => ({
  session: {
    id: "chat",
    runtimeKind: "codex",
    externalSessionId: "native",
    executionTarget: { kind: "local_repo_root", workingDirectory: "/repo" },
    roleSnapshot: null,
    selectedModel: null,
    generatedTitle: null,
    manualTitle: "Chat",
    createdAt: 1000,
    updatedAt: 1000,
    archivedAt: null,
  },
  runtimeSession: {
    runtimeKind: "codex",
    externalSessionId: "native",
    workingDirectory: "/repo",
    startedAt: new Date(1000).toISOString(),
    status: "idle",
  },
});

test("a newly started chat has a known empty baseline without a history read", async () => {
  const store = createAgentSessionsStore("/repo");
  const result = await startWorkspaceSession(
    { workspaceId: "workspace", sessionId: "chat" },
    startedResult().session,
    store,
    () => true,
    async () => startedResult(),
  );
  expect(store.getSessionSnapshot(result.identity)).toMatchObject({
    historyLoadState: "loaded",
    sessionAssociation: { kind: "repository" },
    title: "Chat",
  });
  expect(store.getSessionSnapshot(result.identity)?.messages.items).toEqual([]);
});

test("start response keeps transcript events that arrived before the response", async () => {
  const store = createAgentSessionsStore("/repo");
  const current = createAgentSessionFixture({
    externalSessionId: "native",
    runtimeKind: "codex",
    workingDirectory: "/repo",
    sessionAssociation: { kind: "repository" },
    historyLoadState: "not_requested",
    status: "running",
  });
  store.replaceSession(current);
  const result = await startWorkspaceSession(
    { workspaceId: "workspace", sessionId: "chat" },
    startedResult().session,
    store,
    () => true,
    async () => startedResult(),
  );
  const saved = store.getSessionSnapshot(result.identity);
  expect(saved?.messages).toBe(current.messages);
  expect(saved?.status).toBe("running");
  expect(saved?.historyLoadState).toBe("loaded");
});

test("an already-bound chat enters the shared store without a fabricated history baseline", async () => {
  const store = createAgentSessionsStore("/repo");
  const result = await startWorkspaceSession(
    { workspaceId: "workspace", sessionId: "chat" },
    startedResult().session,
    store,
    () => true,
    async () => ({ ...startedResult(), runtimeSession: null }),
  );
  expect(store.getSessionSnapshot(result.identity)).toMatchObject({
    historyLoadState: "not_requested",
    livePresence: "unobserved",
    sessionAssociation: { kind: "repository" },
    title: "Chat",
  });
});

test("a late start response cannot seed another workspace", async () => {
  const store = createAgentSessionsStore("/other");
  await expect(
    startWorkspaceSession(
      { workspaceId: "workspace", sessionId: "chat" },
      startedResult().session,
      store,
      () => false,
      async () => startedResult(),
    ),
  ).rejects.toThrow("Workspace changed");
  expect(store.listSessionSnapshots()).toEqual([]);
});

test("concurrent fresh and already-bound starts keep the same live session and transcript", async () => {
  const store = createAgentSessionsStore("/repo");
  const fresh = Promise.withResolvers<WorkspaceSessionStartResult>();
  const bound = Promise.withResolvers<WorkspaceSessionStartResult>();
  const ref = { workspaceId: "workspace", sessionId: "chat" };
  const first = startWorkspaceSession(
    ref,
    startedResult().session,
    store,
    () => true,
    () => fresh.promise,
  );
  const second = startWorkspaceSession(
    ref,
    startedResult().session,
    store,
    () => true,
    () => bound.promise,
  );
  bound.resolve({ ...startedResult(), runtimeSession: null });
  const registered = await second;
  expect(store.getSessionSnapshot(registered.identity)?.historyLoadState).toBe("not_requested");
  const live = createAgentSessionFixture({
    ...registered.identity,
    sessionAssociation: { kind: "repository" },
    status: "running",
    historyLoadState: "loaded",
  });
  store.replaceSession(live);
  fresh.resolve(startedResult());
  expect((await first).identity).toEqual(registered.identity);
  const saved = store.getSessionSnapshot(registered.identity);
  expect(store.listSessionSnapshots()).toHaveLength(1);
  expect(saved?.messages).toBe(live.messages);
  expect(saved?.status).toBe("running");
  expect(saved?.historyLoadState).toBe("loaded");
});

test.each(["record", "runtime", "directory", "execution-kind"] as const)(
  "rejects a mismatched startup %s before registering a chat",
  async (field) => {
    const expected = startedResult().session;
    const result = startedResult();
    if (field === "record") result.session.id = "other-chat";
    if (field === "runtime") result.session.runtimeKind = "opencode";
    if (field === "directory") result.session.executionTarget.workingDirectory = "/other";
    if (field === "execution-kind")
      result.session.executionTarget = {
        kind: "local_worktree",
        workingDirectory: "/repo",
        branchName: "test-branch",
        worktreeState: "present",
      };
    const store = createAgentSessionsStore("/repo");
    await expect(
      startWorkspaceSession(
        { workspaceId: "workspace", sessionId: expected.id },
        expected,
        store,
        () => true,
        async () => result,
      ),
    ).rejects.toThrow("different chat target");
    expect(store.listSessionSnapshots()).toEqual([]);
  },
);
