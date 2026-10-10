import { afterEach, beforeEach, expect, test } from "bun:test";
import { Deferred, Effect, Fiber } from "effect";
import type { WorkspaceSessionLaunchRequest } from "@openducktor/contracts";
import { HostOperationError } from "../../effect/host-errors";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import {
  createPersistenceHarness,
  waitFor,
} from "./test-support/workspace-session-runtime-persistence-harness";

let database: SqliteTaskStoreTestHarness;
beforeEach(async () => {
  database = await createSqliteTaskStoreHarness();
});
afterEach(async () => {
  await database.cleanup();
});

const yieldToFibers = Effect.gen(function* () {
  for (let index = 0; index < 20; index += 1) yield* Effect.yieldNow;
});

const textRequest = (h: Awaited<ReturnType<typeof createPersistenceHarness>>) => ({
  ...h.storeRef,
  parts: [{ kind: "text" as const, text: "First" }],
});

test("shutdown during the native start leaves the workspace draft unbound", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  h.state.nativeStart = Deferred.succeed(entered, undefined).pipe(
    Effect.andThen(Deferred.await(release)),
  );
  const service = h.launchService();
  const request: WorkspaceSessionLaunchRequest = {
    ...h.storeRef,
    parts: [
      {
        kind: "attachment",
        attachment: {
          id: "image",
          path: "/staged/image.png",
          name: "image.png",
          kind: "image",
          mime: "image/png",
        },
      },
    ],
  };
  const launch = Effect.runFork(service.launch(request));
  try {
    await Effect.runPromise(Deferred.await(entered));
    // The native start cannot be interrupted, so shutdown waits for it and its cleanup.
    const shutdown = Effect.runFork(service.shutdown());
    await Effect.runPromise(yieldToFibers);
    expect(shutdown.pollUnsafe()).toBeUndefined();
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(shutdown));
    const outcome = await Effect.runPromise(Fiber.join(launch));
    expect(outcome.status).toBe("canceled");
    expect(outcome.session).toBeUndefined();
    expect(outcome.unsentInstruction).toBeUndefined();
    expect(h.starts).toHaveLength(1);
    expect(h.inputs).toEqual([]);
    expect(h.stops).toEqual([]);
    expect(h.releases).toEqual([h.ref]);
    expect((await h.get()).externalSessionId).toBeNull();
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(launch));
  }
});

test("shutdown during the starting hold stops the created session without a send", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  h.state.beforeSnapshot = Deferred.succeed(entered, undefined).pipe(
    Effect.andThen(Deferred.await(release)),
  );
  const service = h.launchService();
  const launch = Effect.runFork(service.launch(textRequest(h)));
  try {
    await Effect.runPromise(Deferred.await(entered));
    const shutdown = Effect.runFork(service.shutdown());
    await Effect.runPromise(yieldToFibers);
    expect(shutdown.pollUnsafe()).toBeUndefined();
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(shutdown));
    const outcome = await Effect.runPromise(Fiber.join(launch));
    expect(outcome.status).toBe("canceled");
    expect(outcome.unsentInstruction).toBeUndefined();
    expect(h.inputs).toEqual([]);
    expect(h.stops.map((ref) => ref.externalSessionId)).toEqual(["native"]);
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(launch));
  }
});

test("a failed resume of a saved workspace session fails without a new session", async () => {
  const h = await createPersistenceHarness(database, "codex", false);
  h.state.beforeControl = Effect.fail(
    new HostOperationError({ operation: "resume", message: "Native resume refused" }),
  );
  const outcome = await Effect.runPromise(h.launchService().launch(textRequest(h)));
  expect(outcome.status).toBe("failed");
  expect(outcome.failure?.message).toContain("Native resume refused");
  expect(outcome.session).toBeUndefined();
  expect(h.starts).toHaveLength(0);
  expect(h.inputs).toEqual([]);
  expect((await h.get()).externalSessionId).toBe("native");
});

test.each(["opencode", "codex", "claude"] as const)(
  "saves and sends a workspace draft after the caller leaves: %s",
  async (kind) => {
    const h = await createPersistenceHarness(database, kind, true);
    const service = h.launchService();
    const gate = await Effect.runPromise(Deferred.make<void>());
    h.state.beforeBind = Deferred.await(gate);
    const request: WorkspaceSessionLaunchRequest = {
      ...h.storeRef,
      parts: [
        { kind: "text", text: "Review " },
        {
          kind: "file_reference",
          file: { id: "file", path: "src/main.ts", name: "main.ts", kind: "code" },
        },
        {
          kind: "attachment",
          attachment: {
            id: "image",
            path: "/staged/image.png",
            name: "image.png",
            kind: "image",
            mime: "image/png",
          },
        },
      ],
    };
    const caller = Effect.runFork(service.launch(request));
    await waitFor(() => h.starts.length === 1);
    await Effect.runPromise(Fiber.interrupt(caller));
    expect((await h.get()).externalSessionId).toBeNull();
    await Effect.runPromise(Deferred.succeed(gate, undefined));
    await waitFor(() => h.inputs.length === 1);
    expect(h.starts).toHaveLength(1);
    expect(h.inputs[0]).toMatchObject({
      parts: request.parts,
      systemPrompt: "Original instructions.",
      model: h.record.selectedModel,
      workingDirectory: h.ref.workingDirectory,
    });
    expect((await h.get()).externalSessionId).toBe(h.ref.externalSessionId);
  },
);

test("a model change waits for the session start, and the first send keeps the saved model", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  const service = h.launchService();
  const gate = await Effect.runPromise(Deferred.make<void>());
  h.state.beforeControl = Deferred.await(gate);
  const caller = Effect.runFork(service.launch(textRequest(h)));
  await waitFor(() => h.starts.length === 1 && h.operationGate.isActive(h.storeRef));
  let changed = false;
  const change = Effect.runFork(
    h.live
      .updateSessionModel({
        ...h.ref,
        sessionScope: { kind: "repository" },
        model: { providerId: "other", modelId: "other" },
      })
      .pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            changed = true;
          }),
        ),
      ),
  );
  await Effect.runPromise(Effect.yieldNow);
  expect(changed).toBe(false);
  await Effect.runPromise(Deferred.succeed(gate, undefined));
  expect((await Effect.runPromise(Fiber.join(caller))).status).toBe("completed");
  await Effect.runPromise(Fiber.join(change));
  expect(changed).toBe(true);
  expect(h.inputs[0]?.model).toEqual(h.record.selectedModel ?? undefined);
});

test("a failed first send returns the saved session and the unsent message", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  h.state.failSend = true;
  const request = textRequest(h);
  const outcome = await Effect.runPromise(h.launchService().launch(request));
  expect(outcome).toMatchObject({
    status: "failed",
    session: { externalSessionId: "native" },
    failure: { message: "runtime rejected message" },
  });
  expect(outcome.unsentInstruction).toEqual(request.parts);
  expect(outcome.acceptedMessage).toBeUndefined();
  expect(h.inputs).toHaveLength(1);
  expect(h.starts).toHaveLength(1);
  expect(h.stops).toEqual([]);
  expect((await h.get()).externalSessionId).toBe("native");
});

test("keeps native acceptance when saving message details fails", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  h.state.failActivity = true;
  const outcome = await Effect.runPromise(h.launchService().launch(textRequest(h)));
  expect(outcome.status).toBe("failed");
  expect(outcome.acceptedMessage?.messageId).toBe("user-1");
  expect(outcome.unsentInstruction).toBeUndefined();
  expect(outcome.failure?.message).toContain("activity write failed");
  expect(h.starts).toHaveLength(1);
  expect(h.inputs).toHaveLength(1);
});

test("a starting hold failure releases the unbound native session", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  h.state.failSnapshot = true;
  const outcome = await Effect.runPromise(h.launchService().launch(textRequest(h)));
  expect(outcome.status).toBe("failed");
  expect(outcome.session).toBeUndefined();
  expect(outcome.failure?.message).toContain("snapshot read failed");
  expect(h.starts).toHaveLength(1);
  expect(h.releases).toEqual([h.ref]);
  expect((await h.get()).externalSessionId).toBeNull();
  expect(h.inputs).toEqual([]);
});
