import type { JsonValue, RuntimeKind } from "@openducktor/contracts";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Deferred, Effect } from "effect";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import type { HostError } from "../../effect/host-errors";
import { createModelNamingService } from "../../test-support/naming-test-doubles";
import {
  createPersistenceHarness,
  waitFor,
} from "./test-support/workspace-session-runtime-persistence-harness";
import { requireConfirmedAutomaticBranch } from "./workspace-session-naming";

const NAMING_MODEL = { runtimeKind: "claude", providerId: "anthropic", modelId: "haiku" } as const;

describe("Workspace Session naming", () => {
  let database: SqliteTaskStoreTestHarness;
  beforeEach(async () => {
    database = await createSqliteTaskStoreHarness();
  });
  afterEach(async () => {
    await database.cleanup();
  });

  const setup = async (
    answer: Effect.Effect<JsonValue, HostError>,
    runtimeKind: RuntimeKind = "opencode",
  ) => {
    const h = await createPersistenceHarness(database, runtimeKind);
    h.config.namingModel = NAMING_MODEL;
    const model = createModelNamingService(() => answer);
    h.persistence.registerCreated(h.storeRef);
    h.naming.service = model.service;
    return { h, requests: model.requests };
  };

  test("keeps a typed branch and names the title without delaying the message", async () => {
    const pending = Effect.runSync(Deferred.make<JsonValue, HostError>());
    const { h, requests } = await setup(Deferred.await(pending));
    await h.send("Fix login redirect after OAuth");

    expect(h.inputs).toHaveLength(1);
    expect((await h.get()).generatedTitle).toBe("First accepted prompt");
    await waitFor(() => requests.length === 1);
    expect(requests[0]?.outputSchema["required"]).toEqual(["title"]);
    Effect.runSync(Deferred.succeed(pending, { title: "OAuth login redirect" }));
    await waitFor(async () => (await h.get()).generatedTitle === "OAuth login redirect");
    expect((await h.get()).executionTarget).toMatchObject({ branchName: "feature/session" });
  });

  test("saves the model title of a runtime without rename and never renames its session", async () => {
    const { h, requests } = await setup(Effect.succeed({ title: "Login fix" }), "antigravity");
    await h.send("Fix login");
    await waitFor(() => requests.length === 1);
    await waitFor(async () => (await h.get()).generatedTitle === "Login fix");

    expect(h.titleAttempts).toEqual([]);
    expect(h.renameFailures).toEqual([]);
  });

  test("keeps a manual title that the user set before the model title arrives", async () => {
    const pending = Effect.runSync(Deferred.make<JsonValue, HostError>());
    const { h, requests } = await setup(Deferred.await(pending));
    await h.send("Fix login");
    await waitFor(() => requests.length === 1);
    await Effect.runPromise(h.store.rename({ ...h.storeRef, manualTitle: "My title" }));
    Effect.runSync(Deferred.succeed(pending, { title: "Login fix" }));
    await waitFor(async () => (await h.get()).generatedTitle === "Login fix");
    expect((await h.get()).manualTitle).toBe("My title");
    expect(h.titleAttempts).not.toContain("Login fix");
  });

  test("asks no title for a chat with a manual title", async () => {
    const { h, requests } = await setup(Effect.succeed({ title: "Login fix" }));
    await Effect.runPromise(h.store.rename({ ...h.storeRef, manualTitle: "My title" }));
    await h.send("Fix login");
    await Bun.sleep(5);
    expect(requests).toEqual([]);
  });

  test("names only the first message of a chat", async () => {
    const { h, requests } = await setup(Effect.succeed({ title: "Login fix" }));
    await h.send("Fix login");
    await waitFor(() => requests.length === 1);
    await h.send("Also fix logout");
    await Bun.sleep(5);
    expect(requests).toHaveLength(1);
  });

  test("makes no request for a chat that this host did not create", async () => {
    const h = await createPersistenceHarness(database);
    h.config.namingModel = NAMING_MODEL;
    let calls = 0;
    h.naming.service = {
      generate: () =>
        Effect.sync(() => (calls += 1)).pipe(Effect.as({ status: "disabled" as const })),
    };
    await h.send("Fix login");
    await Bun.sleep(5);
    expect(calls).toBe(0);
    expect((await h.get()).generatedTitle).toBe("First accepted prompt");
  });
});

describe("automatic chat worktree names", () => {
  const session = (id: string, workingDirectory: string, branchName: string | null) => ({
    id,
    executionTarget: {
      kind: "local_worktree" as const,
      workingDirectory,
      branchName,
      worktreeState: "present" as const,
    },
  });
  const id = "1a2b3c4d-0000-4000-8000-000000000000";

  test("stops an unproven temporary branch before the first message", async () => {
    const unproven = session(id, "/worktrees/workspace-sessions/1a2b3c4d", "odt/1a2b3c4d");
    const error = await Effect.runPromise(Effect.flip(requireConfirmedAutomaticBranch(unproven)));
    expect(error.message).toContain("git branch -m odt/1a2b3c4d <name>");
  });

  test("stops an unproven temporary branch after the prefix setting changed", async () => {
    const renamedPrefix = session(id, "/worktrees/workspace-sessions/1a2b3c4d", "old/1a2b3c4d");
    const error = await Effect.runPromise(
      Effect.flip(requireConfirmedAutomaticBranch(renamedPrefix)),
    );
    expect(error.message).toContain("git branch -m old/1a2b3c4d <name>");
  });

  test("allows a typed branch, a chat with activity, and a typed folder", async () => {
    const typed = session(id, "/worktrees/workspace-sessions/1a2b3c4d", "feature/typed");
    const active = {
      ...session(id, "/worktrees/workspace-sessions/1a2b3c4d", "odt/1a2b3c4d"),
      lastActivityAt: 1,
    };
    const typedFolder = session(id, "/worktrees/workspace-sessions/login", "odt/1a2b3c4d");
    for (const allowed of [typed, active, typedFolder])
      await Effect.runPromise(requireConfirmedAutomaticBranch(allowed));
  });
});
