import { expect, mock, test } from "bun:test";
import type { BackgroundOperationSnapshot } from "@openducktor/contracts";
import {
  createTestClientConnection,
  createTestHostConnection,
} from "../test-support/test-client-connection";
import { createBackgroundOperationStore } from "./background-operation-store";

test("keeps a lost operation's evidence and accepts only a matching late result", async () => {
  const workspace = { workspaceId: "workspace", repoPath: "/repo" };
  const target = { kind: "task", taskId: "task" } as const;
  const origin = { workspace, target, action: "Delete task" };
  const subscription = Promise.withResolvers<void>();
  type Listener = Parameters<
    ReturnType<typeof createTestHostConnection>["subscribeBackgroundOperationProgress"]
  >[0];
  let listener: Listener | undefined;
  const host = createTestHostConnection({
    backgroundOperationHostEpoch: () => "host",
    subscribeBackgroundOperationProgress: async (receive) => {
      listener = receive;
      await subscription.promise;
      return () => {
        listener = undefined;
      };
    },
  });
  const store = createBackgroundOperationStore(host);
  const sent = Promise.withResolvers<string>();
  const reply = Promise.withResolvers<void>();
  const invoke = mock(({ operationId }: { operationId: string }) => {
    sent.resolve(operationId);
    return reply.promise;
  });
  const run = store.run(origin, invoke);
  try {
    expect(store.getSnapshot()).toMatchObject([{ phase: "running" }]);
    expect(invoke).not.toHaveBeenCalled();
    await expect(store.run(origin, invoke)).rejects.toThrow("An operation is running");
    subscription.resolve();
    const operationId = await sent.promise;
    const base = {
      phase: "running",
      operationId,
      workspace,
      target,
      hostInstanceId: "host",
      revision: 1,
      steps: [{ id: "task-delete", label: "Delete task", state: "completed", details: [] }],
    } satisfies BackgroundOperationSnapshot;
    const emit = (payload: BackgroundOperationSnapshot) => {
      if (!listener) throw new Error("Progress subscription is missing.");
      listener({ channel: "openducktor://background-operation-progress", payload });
    };
    emit(base);
    const unknown = new Error("The reply was lost.");
    reply.reject(unknown);
    expect(await run.catch((cause) => cause)).toBe(unknown);
    expect(store.getSnapshot()).toMatchObject([{ phase: "unconfirmed", progress: base }]);
    expect(store.isRunning(workspace, target)).toBe(false);
    const terminal = {
      ...base,
      revision: 2,
      phase: "failed",
      failure: {
        stage: "attachments",
        code: "cleanup_pending",
        message: "Could not purge attachments.",
        nextAction: "Check the attachment directory.",
      },
    } satisfies BackgroundOperationSnapshot;
    emit({ ...terminal, hostInstanceId: "different-host" });
    emit({ ...terminal, workspace: { ...workspace, repoPath: "/other" } });
    emit({ ...terminal, revision: 1 });
    expect(store.getSnapshot()[0]?.phase).toBe("unconfirmed");
    emit(terminal);
    expect(store.getSnapshot()).toMatchObject([{ phase: "failed", progress: terminal }]);
    store.dismissFailure(operationId);
    emit(terminal);
    expect(store.getSnapshot()).toMatchObject([{ failureDismissed: true }]);
    expect(invoke).toHaveBeenCalledTimes(1);
  } finally {
    store.dispose();
  }
});

test("a successful archive discards only the consented file version", async () => {
  const { backgroundOperations } = createTestClientConnection();
  const workspace = { workspaceId: "workspace", repoPath: "/repo" };
  const target = { kind: "chat", sessionId: "chat" } as const;
  const consented = {
    fileId: "notes.md",
    contents: "consented draft",
    baseline: {
      kind: "text",
      rootPath: "/repo",
      relativePath: "notes.md",
      contents: "saved",
      size: 5,
      mtimeMs: null,
      revision: "original",
    },
    branch: "main",
  } as const;
  const newer = { ...consented, contents: "newer draft" };
  try {
    const reply = Promise.withResolvers<void>();
    const run = backgroundOperations.run(
      { workspace, target, action: "Archive session", archiveDraft: consented },
      () => reply.promise,
    );
    expect(
      backgroundOperations.getArchiveDraft(
        workspace.workspaceId,
        target.sessionId,
        consented.fileId,
      ),
    ).toBe(consented);
    backgroundOperations.replaceArchiveDraft(
      workspace.workspaceId,
      target.sessionId,
      consented,
      newer,
    );
    reply.resolve();
    await run;
    expect(
      backgroundOperations.getArchiveDraft(
        workspace.workspaceId,
        target.sessionId,
        consented.fileId,
      ),
    ).toBe(newer);
    expect(backgroundOperations.getSnapshot()).toMatchObject([
      { phase: "succeeded", archiveDraft: newer },
    ]);
  } finally {
    backgroundOperations.dispose();
  }
});

test("shows final steps after a success reply without repeating settlement", async () => {
  type Listener = Parameters<
    ReturnType<typeof createTestHostConnection>["subscribeBackgroundOperationProgress"]
  >[0];
  let receive: Listener | undefined;
  const host = createTestHostConnection({
    subscribeBackgroundOperationProgress: async (listener) => {
      receive = listener;
      return () => {};
    },
  });
  const settled = mock(() => {});
  const store = createBackgroundOperationStore(host, settled);
  const workspace = { workspaceId: "workspace", repoPath: "/repo" };
  const target = { kind: "task", taskId: "task" } as const;
  try {
    const running = await store.run(
      { workspace, target, action: "Remove worktree" },
      async ({ operationId }) => {
        const progress: BackgroundOperationSnapshot = {
          operationId,
          hostInstanceId: "host",
          workspace,
          target,
          revision: 1,
          phase: "running",
          steps: [{ id: "worktrees", label: "Remove worktrees", details: [], state: "running" }],
        };
        receive?.({ channel: "openducktor://background-operation-progress", payload: progress });
        return progress;
      },
    );
    expect(store.getSnapshot()).toMatchObject([{ phase: "succeeded", progress: running }]);
    const terminal: BackgroundOperationSnapshot = {
      ...running,
      phase: "succeeded",
      revision: 3,
      steps: running.steps.map((step) => ({ ...step, state: "completed" })),
    };
    receive?.({ channel: "openducktor://background-operation-progress", payload: terminal });
    receive?.({
      channel: "openducktor://background-operation-progress",
      payload: { ...running, revision: 2 },
    });
    expect(store.getSnapshot()).toMatchObject([{ phase: "succeeded", progress: terminal }]);
    expect(settled).toHaveBeenCalledTimes(1);
  } finally {
    store.dispose();
  }
});
