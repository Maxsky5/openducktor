import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AgentSessionLiveRef, AgentSessionTranscriptEvent } from "@openducktor/contracts";
import { Deferred, Effect } from "effect";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import {
  createPersistenceHarness,
  waitFor,
} from "./test-support/workspace-session-runtime-persistence-harness";

const titlelessMessage = (ref: AgentSessionLiveRef): AgentSessionTranscriptEvent => ({
  type: "user_message",
  sessionRef: ref,
  externalSessionId: ref.externalSessionId,
  timestamp: "2026-09-07T10:00:00Z",
  messageId: "user-titleless",
  message: "Context",
  parts: [{ kind: "text", text: "Context", synthetic: true }],
  state: "read",
});

describe("Codex Workspace Session title sync", () => {
  let database: SqliteTaskStoreTestHarness;
  beforeEach(async () => {
    database = await createSqliteTaskStoreHarness();
  });
  afterEach(async () => {
    await database.cleanup();
  });

  test("saves a fresh Codex title with the accepted prompt and syncs it after turn completion", async () => {
    const h = await createPersistenceHarness(database, "codex");
    await h.send("Name this chat");
    expect((await h.get()).generatedTitle).toBe("First accepted prompt");
    expect(h.titleAttempts).toEqual([]);

    await h.emit({
      type: "session_idle",
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:00:30Z",
    });
    expect(h.titleAttempts).toEqual([]);

    await h.emit({
      type: "session_idle",
      turnCompleted: true,
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:01:00Z",
    });
    await waitFor(() => h.titleAttempts.length === 1);
    expect(h.titleAttempts).toEqual(["First accepted prompt"]);
    expect(h.renameFailures).toEqual([]);
    await h.emit({
      type: "session_idle",
      turnCompleted: true,
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:02:00Z",
    });
    expect(h.titleAttempts).toEqual(["First accepted prompt"]);
  });

  test("keeps a cold Codex reattach title until its first turn ends", async () => {
    const h = await createPersistenceHarness(database, "codex");
    h.state.firstTurnCompleted = false;
    await Effect.runPromise(
      h.live.resumeSession({
        ...h.ref,
        resumeMode: "reattach",
        sessionScope: { kind: "repository" },
      }),
    );
    const renamed = await Effect.runPromise(
      h.workspaceService().rename({
        workspaceId: "fairnest",
        sessionId: "session-1",
        manualTitle: "Cold title",
      }),
    );
    expect(renamed.manualTitle).toBe("Cold title");
    expect(h.titleAttempts).toEqual([]);

    await h.emit({
      type: "session_idle",
      turnCompleted: true,
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:01:00Z",
    });
    await waitFor(() => h.titleAttempts.length === 1);
    expect(h.titleAttempts).toEqual(["Cold title"]);
    await Effect.runPromise(
      h.workspaceService().rename({
        workspaceId: "fairnest",
        sessionId: "session-1",
        manualTitle: "Later title",
      }),
    );
    expect(h.titleAttempts).toEqual(["Cold title", "Later title"]);
  });

  test("syncs a saved title when the first turn ends during reattach", async () => {
    const h = await createPersistenceHarness(database, "codex");
    await Effect.runPromise(h.store.rename({ ...h.storeRef, manualTitle: "Saved title" }));
    h.state.firstTurnCompleted = false;
    h.state.beforeControl = h
      .emitEffect({
        type: "session_idle",
        turnCompleted: true,
        sessionRef: h.ref,
        externalSessionId: h.ref.externalSessionId,
        timestamp: "2026-09-07T10:01:00Z",
      })
      .pipe(Effect.orDie);

    await Effect.runPromise(
      h.live.resumeSession({
        ...h.ref,
        resumeMode: "reattach",
        sessionScope: { kind: "repository" },
      }),
    );

    await waitFor(() => h.titleAttempts.length === 1);
    expect(h.titleAttempts).toEqual(["Saved title"]);
    expect(h.persistence.isCodexTitleSyncPending(h.ref)).toBe(false);
  });

  test("clears a reattach gate when the runtime resume fails", async () => {
    const h = await createPersistenceHarness(database, "codex");
    await Effect.runPromise(h.store.rename({ ...h.storeRef, manualTitle: "Saved title" }));
    let pendingDuringResume = false;
    h.state.beforeControl = Effect.sync(() => {
      pendingDuringResume = h.persistence.isCodexTitleSyncPending(h.ref);
    }).pipe(Effect.zipRight(Effect.dieMessage("resume failed")));

    await expect(
      Effect.runPromise(
        h.live.resumeSession({
          ...h.ref,
          resumeMode: "reattach",
          sessionScope: { kind: "repository" },
        }),
      ),
    ).rejects.toThrow("resume failed");
    expect(pendingDuringResume).toBe(true);
    expect(h.persistence.isCodexTitleSyncPending(h.ref)).toBe(false);
  });

  test("syncs a later Codex title after a titleless completed turn", async () => {
    const h = await createPersistenceHarness(database, "codex");
    await h.emit(titlelessMessage(h.ref));
    await h.emit({
      type: "session_idle",
      turnCompleted: true,
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:01:00Z",
    });
    await waitFor(() => !h.persistence.isCodexTitleSyncPending(h.ref));
    expect((await h.get()).generatedTitle).toBeNull();
    expect(h.titleAttempts).toEqual([]);

    await h.send("Name this chat");
    await h.emit({
      type: "session_idle",
      turnCompleted: true,
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:02:00Z",
    });
    await waitFor(() => h.titleAttempts.length === 1);
    expect(h.titleAttempts).toEqual(["First accepted prompt"]);
    expect(h.state.nativeTitle).toBe("First accepted prompt");
  });

  test("waits for the later turn when its title arrives during a queued sync", async () => {
    const h = await createPersistenceHarness(database, "codex");
    await h.emit(titlelessMessage(h.ref));
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const holdingGate = Effect.runPromise(
      h.sessionTitleGate.run(
        h.storeRef,
        Deferred.succeed(entered, undefined).pipe(Effect.zipRight(Deferred.await(release))),
      ),
    );
    await Effect.runPromise(Deferred.await(entered));
    await h.emit({
      type: "session_idle",
      turnCompleted: true,
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:01:00Z",
    });
    await h.emit({
      type: "user_message",
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:01:30Z",
      messageId: "user-titled",
      message: "Later title",
      parts: [{ kind: "text", text: "Later title" }],
      state: "read",
    });
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await holdingGate;
    await Effect.runPromise(h.sessionTitleGate.run(h.storeRef, Effect.void));
    expect(h.titleAttempts).toEqual([]);

    await h.emit({
      type: "session_idle",
      turnCompleted: true,
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:02:00Z",
    });
    await waitFor(() => h.titleAttempts.length === 1);
    expect(h.titleAttempts).toEqual(["Later title"]);
  });

  test("syncs the latest manual Codex title after the first turn", async () => {
    const h = await createPersistenceHarness(database, "codex");
    await Effect.runPromise(h.store.rename({ ...h.storeRef, manualTitle: "Startup title" }));
    await h.send("First prompt");
    const renamed = await Effect.runPromise(
      h.workspaceService().rename({
        workspaceId: "fairnest",
        sessionId: "session-1",
        manualTitle: "Manual title",
      }),
    );
    expect(renamed.manualTitle).toBe("Manual title");
    expect(h.titleAttempts).toEqual([]);

    await h.emit({
      type: "session_idle",
      turnCompleted: true,
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:01:00Z",
    });
    await waitFor(() => h.titleAttempts.length === 1);
    expect(h.titleAttempts).toEqual(["Manual title"]);
  });

  test("defers a queued manual rename until the first Codex title sync enters the title gate", async () => {
    const h = await createPersistenceHarness(database, "codex");
    await h.send("First prompt");
    const entered = await Effect.runPromise(Deferred.make<void>());
    const release = await Effect.runPromise(Deferred.make<void>());
    const holdingGate = Effect.runPromise(
      h.sessionTitleGate.run(
        h.storeRef,
        Deferred.succeed(entered, undefined).pipe(Effect.zipRight(Deferred.await(release))),
      ),
    );
    await Effect.runPromise(Deferred.await(entered));

    let renameRequested!: () => void;
    const requested = new Promise<void>((resolve) => {
      renameRequested = resolve;
    });
    h.state.onGateRequest = renameRequested;
    const renaming = Effect.runPromise(
      h.workspaceService().rename({
        workspaceId: "fairnest",
        sessionId: "session-1",
        manualTitle: "Manual title",
      }),
    );
    await requested;
    await h.emit({
      type: "session_idle",
      turnCompleted: true,
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:01:00Z",
    });
    expect(h.persistence.isCodexTitleSyncPending(h.ref)).toBe(true);

    await Effect.runPromise(Deferred.succeed(release, undefined));
    await holdingGate;
    await renaming;
    await waitFor(() => h.titleAttempts.length === 1);
    expect(h.titleAttempts).toEqual(["Manual title"]);
  });

  test("reports a Codex title failure after acceptance and keeps the intended title", async () => {
    const h = await createPersistenceHarness(database, "codex");
    h.state.failTitle = true;
    await h.send("First prompt");
    await h.emit({
      type: "session_idle",
      turnCompleted: true,
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:01:00Z",
    });
    await waitFor(() => h.renameFailures.length === 1);
    expect(h.renameFailures[0]).toContain("title");
    expect((await h.get()).generatedTitle).toBe("First accepted prompt");
    expect(h.titleAttempts).toEqual(["First accepted prompt"]);
    expect(h.state.nativeTitle).toBeNull();
  });

  test("keeps the Codex title when the RPC fails after its native name write", async () => {
    const h = await createPersistenceHarness(database, "codex");
    h.state.failTitleAfterWrite = true;
    await h.send("First prompt");
    await h.emit({
      type: "session_idle",
      turnCompleted: true,
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:01:00Z",
    });
    await waitFor(() => h.renameFailures.length === 1);
    expect(h.state.nativeTitle).toBe("First accepted prompt");
    expect((await h.get()).generatedTitle).toBe("First accepted prompt");
    expect(h.renameFailures[0]).toContain("Reattach this chat or rename it to retry");

    h.state.failTitleAfterWrite = false;
    const renamed = await Effect.runPromise(
      h.workspaceService().rename({
        workspaceId: "fairnest",
        sessionId: "session-1",
        manualTitle: "Manual title",
      }),
    );
    expect(renamed.manualTitle).toBe("Manual title");
    expect(h.state.nativeTitle).toBe("Manual title");
  });

  test("keeps a failed manual Codex rename for an explicit retry", async () => {
    const h = await createPersistenceHarness(database, "codex");
    h.persistence.markCodexTitleSyncPending(h.ref);
    await h.emit({
      type: "session_idle",
      turnCompleted: true,
      sessionRef: h.ref,
      externalSessionId: h.ref.externalSessionId,
      timestamp: "2026-09-07T10:01:00Z",
    });
    await waitFor(() => !h.persistence.isCodexTitleSyncPending(h.ref));
    h.state.failTitleAfterWrite = true;
    await expect(
      Effect.runPromise(
        h.workspaceService().rename({
          workspaceId: "fairnest",
          sessionId: "session-1",
          manualTitle: "Manual title",
        }),
      ),
    ).rejects.toThrow("The saved title remains");
    expect((await h.get()).manualTitle).toBe("Manual title");
    expect(h.state.nativeTitle).toBe("Manual title");

    h.state.failTitleAfterWrite = false;
    await Effect.runPromise(
      h.workspaceService().rename({
        workspaceId: "fairnest",
        sessionId: "session-1",
        manualTitle: "Manual title",
      }),
    );
    expect(h.titleAttempts).toEqual(["Manual title", "Manual title"]);
  });
});
