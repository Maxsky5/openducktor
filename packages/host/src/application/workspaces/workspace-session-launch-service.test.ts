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
import { createNodeSessionLaunchControls } from "../../composition/node/node-session-launch-controls";

let database: SqliteTaskStoreTestHarness;
beforeEach(async () => {
  database = await createSqliteTaskStoreHarness();
});
afterEach(async () => {
  await database.cleanup();
});

test.each(
  (["cancel", "shutdown"] as const).flatMap((action) =>
    (["attachments", "native", "hold"] as const).map((stage) => [action, stage] as const),
  ),
)("%s during %s leaves the workspace draft unbound", async (action, stage) => {
  const h = await createPersistenceHarness(database, "codex", true);
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  const pause = Deferred.succeed(entered, undefined).pipe(Effect.andThen(Deferred.await(release)));
  if (stage === "attachments") h.state.beforeResolveParts = pause;
  else if (stage === "native") h.state.nativeStart = pause;
  else h.state.beforeSnapshot = pause;
  const service = h.launchService();
  const request: WorkspaceSessionLaunchRequest = {
    ...h.storeRef,
    launchAttemptId: "canceled-preparation",
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
    const cancel = Effect.runFork(
      action === "cancel" ? service.cancel(request) : service.shutdown(),
    );
    await Effect.runPromise(Effect.yieldNow);
    await Effect.runPromise(Deferred.succeed(release, undefined));
    const outcome = await Effect.runPromise(Fiber.join(launch));
    await Effect.runPromise(Fiber.join(cancel));
    expect(outcome).toMatchObject({
      phase: "canceled",
      acceptance: "not_submitted",
      ownershipSaved: false,
      recoveryAllowed: false,
    });
    expect(h.starts).toHaveLength(stage === "attachments" ? 0 : 1);
    expect(h.inputs).toEqual([]);
    expect(h.stops).toEqual([]);
    expect(h.releases).toEqual(stage === "attachments" ? [] : [h.ref]);
    expect((await h.get()).externalSessionId).toBeNull();
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(launch));
    await Effect.runPromise(service.shutdown());
  }
});

test.each(["stop", "resend"] as const)(
  "%s retires rejected workspace launch recovery",
  async (action) => {
    const h = await createPersistenceHarness(database, "codex", true);
    const service = h.launchService();
    h.state.rejectSend = true;
    const request = {
      ...h.storeRef,
      launchAttemptId: "attempt",
      parts: [{ kind: "text" as const, text: "First" }],
    };
    const failed = await Effect.runPromise(service.launch(request));
    expect(failed.recoveryAllowed).toBe(true);
    h.state.rejectSend = false;
    const { commands } = createNodeSessionLaunchControls(h.live, [service]);
    if (action === "stop") await Effect.runPromise(commands.stopSession(h.ref));
    else
      await Effect.runPromise(
        commands.sendUserMessage({
          ...h.ref,
          sessionScope: { kind: "repository" },
          parts: request.parts,
        }),
      );
    const [retired] = await Effect.runPromise(service.read(request));
    expect(retired).toMatchObject({ phase: "canceled", recoveryAllowed: false });
    expect(retired?.failure).toEqual(failed.failure);
    await expect(Effect.runPromise(service.recover(request))).rejects.toThrow(
      "recovery is unavailable",
    );
    expect(h.inputs.filter((input) => "parts" in input)).toHaveLength(action === "stop" ? 1 : 2);
    expect(h.starts).toHaveLength(1);
    expect(h.stops).toEqual(action === "stop" ? [h.ref] : []);
    expect((await h.get()).externalSessionId).toBe("native");
  },
);

test("a composer resend cannot race an active workspace launch recovery", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  const service = h.launchService();
  h.state.rejectSend = true;
  const request = {
    ...h.storeRef,
    launchAttemptId: "attempt",
    parts: [{ kind: "text" as const, text: "First" }],
  };
  expect((await Effect.runPromise(service.launch(request))).recoveryAllowed).toBe(true);
  h.state.rejectSend = false;
  const entered = await Effect.runPromise(Deferred.make<void>());
  const release = await Effect.runPromise(Deferred.make<void>());
  h.state.beforeControl = Deferred.succeed(entered, undefined).pipe(
    Effect.andThen(Deferred.await(release)),
  );
  const recovery = Effect.runFork(service.recover(request));
  const { commands } = createNodeSessionLaunchControls(h.live, [service]);
  try {
    await Effect.runPromise(Deferred.await(entered));
    const resend = commands.sendUserMessage({
      ...h.ref,
      sessionScope: { kind: "repository" },
      parts: request.parts,
    });
    const result = await Effect.runPromise(
      Effect.result(resend).pipe(Effect.timeout("100 millis")),
    );
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { message: expect.stringContaining("launch is in progress") },
    });
  } finally {
    await Effect.runPromise(Deferred.succeed(release, undefined));
    await Effect.runPromise(Fiber.join(recovery));
  }
  expect(h.inputs.filter((input) => "parts" in input)).toHaveLength(2);
});

test("retains a saved workspace session when resume fails and retries its first instruction", async () => {
  const h = await createPersistenceHarness(database, "codex", false);
  h.state.beforeControl = Effect.fail(
    new HostOperationError({ operation: "resume", message: "Native resume refused" }),
  );
  const service = h.launchService();
  const request = {
    ...h.storeRef,
    launchAttemptId: "resume-failed",
    parts: [{ kind: "text" as const, text: "First" }],
  };
  const failed = await Effect.runPromise(service.launch(request));
  expect(failed.session?.externalSessionId).toBe("native");
  expect(failed.failure?.message).toContain("Native resume refused");
  expect(failed.recoveryAllowed).toBe(true);
  h.state.beforeControl = Effect.void;
  const recovered = await Effect.runPromise(service.recover(request));
  expect(recovered.acceptance).toBe("accepted");
  expect(h.starts).toHaveLength(0);
  expect(h.inputs.filter((input) => "parts" in input)).toHaveLength(1);
});

test.each(["opencode", "codex", "claude"] as const)(
  "saves and sends a workspace draft after the caller leaves: %s",
  async (kind) => {
    const h = await createPersistenceHarness(database, kind, true);
    const speed = kind === "opencode" ? "standard" : "fast";
    await Effect.runPromise(h.store.setSpeed({ ...h.storeRef, speed }));
    const service = h.launchService();
    const gate = await Effect.runPromise(Deferred.make<void>());
    h.state.beforeBind = Deferred.await(gate);
    const request: WorkspaceSessionLaunchRequest = {
      ...h.storeRef,
      launchAttemptId: "attempt",
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
    const outcome = await Effect.runPromise(service.launch(request));
    expect(outcome.phase).toBe("completed");
    expect(outcome.acceptance).toBe("accepted");
    expect(outcome.ownershipSaved).toBe(true);
    expect(h.starts).toHaveLength(1);
    expect(h.starts[0]?.speed).toBe(speed);
    expect(h.inputs).toHaveLength(1);
    expect(h.inputs[0]).toMatchObject({
      parts: request.parts,
      systemPrompt: "Original instructions.",
      model: h.record.selectedModel,
      speed,
      workingDirectory: h.ref.workingDirectory,
    });
    expect(await h.get()).toMatchObject({ externalSessionId: h.ref.externalSessionId, speed });
  },
);

test("keeps model changes behind the first instruction", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  const service = h.launchService();
  const request = {
    ...h.storeRef,
    launchAttemptId: "attempt",
    parts: [{ kind: "text" as const, text: "First" }],
  };
  const gate = await Effect.runPromise(Deferred.make<void>());
  h.state.beforeControl = Deferred.await(gate);
  const caller = Effect.runFork(service.launch(request));
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
  expect((await Effect.runPromise(Fiber.join(caller))).acceptance).toBe("accepted");
  await Effect.runPromise(Fiber.join(change));
  expect(changed).toBe(true);
  expect(h.inputs[0]?.model).toEqual(h.record.selectedModel ?? undefined);
});

test("blocks another send when runtime acceptance is unknown", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  const service = h.launchService();
  h.state.failSend = true;
  const request = {
    ...h.storeRef,
    launchAttemptId: "attempt",
    parts: [{ kind: "text" as const, text: "First" }],
  };
  const failed = await Effect.runPromise(service.launch(request));
  expect(failed.acceptance).toBe("unknown");
  expect(failed.recoveryAllowed).toBe(false);
  h.state.failSend = false;
  await expect(Effect.runPromise(service.recover(request))).rejects.toThrow(
    "recovery is unavailable",
  );
  expect(h.inputs).toHaveLength(1);
  expect(h.starts).toHaveLength(1);
});

test("retries a rejected instruction once on the same saved session", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  const service = h.launchService();
  h.state.rejectSend = true;
  const request = {
    ...h.storeRef,
    launchAttemptId: "attempt",
    parts: [{ kind: "text" as const, text: "First" }],
  };
  const failed = await Effect.runPromise(service.launch(request));
  expect(failed.acceptance).toBe("rejected");
  expect(failed.recoveryAllowed).toBe(true);
  h.state.rejectSend = false;
  const results = await Promise.all([
    Effect.runPromise(service.recover(request)),
    Effect.runPromise(service.recover(request)),
  ]);
  expect(results.map((result) => result.acceptance)).toEqual(["accepted", "accepted"]);
  expect(h.starts).toHaveLength(1);
  expect(h.inputs.filter((input) => "parts" in input).map((input) => input.parts)).toEqual([
    request.parts,
    request.parts,
  ]);
});

test("keeps native acceptance when saving message details fails", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  const service = h.launchService();
  h.state.failActivity = true;
  const request = {
    ...h.storeRef,
    launchAttemptId: "attempt",
    parts: [{ kind: "text" as const, text: "First" }],
  };
  const failed = await Effect.runPromise(service.launch(request));
  expect(failed.acceptance).toBe("accepted");
  expect(failed.acceptedMessage?.messageId).toBe("user-1");
  expect(failed.recoveryAllowed).toBe(false);
  h.state.failActivity = false;
  await Effect.runPromise(service.recover(request));
  expect(h.starts).toHaveLength(1);
  expect(h.inputs).toHaveLength(1);
});

test("a starting hold failure releases the unbound native session", async () => {
  const h = await createPersistenceHarness(database, "codex", true);
  h.state.failSnapshot = true;
  const outcome = await Effect.runPromise(
    h.launchService().launch({
      ...h.storeRef,
      launchAttemptId: "attempt",
      parts: [{ kind: "text", text: "First" }],
    }),
  );
  expect(outcome.phase).toBe("failed");
  expect(outcome.acceptance).toBe("not_submitted");
  expect(outcome.ownershipSaved).toBe(false);
  expect(outcome.failure?.message).toContain("snapshot read failed");
  expect(h.starts).toHaveLength(1);
  expect(h.releases).toEqual([h.ref]);
  expect((await h.get()).externalSessionId).toBeNull();
  expect(h.inputs).toEqual([]);
});
