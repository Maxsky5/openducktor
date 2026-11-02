import { afterEach, beforeEach, expect, test } from "bun:test";
import type {
  AgentSessionLiveEnvelope,
  AgentSessionLiveSnapshot,
  AgentSessionTranscriptEvent,
  TaskAgentSessions,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { eq } from "drizzle-orm";
import { workspaces } from "../../adapters/sqlite/sqlite-host-settings-schema";
import { tasks, taskSessions } from "../../adapters/sqlite/sqlite-host-database-schema";
import { TestClock } from "effect/testing";
import {
  createSqliteTaskStoreHarness,
  type SqliteTaskStoreTestHarness,
} from "../../adapters/sqlite/sqlite-task-store-test-support";
import { HostOperationError } from "../../effect/host-errors";
import { createAgentSessionRecord } from "../../ports/task-store-port-contract.test-support";
import { workspaceSessionOwnership } from "../../test-support/workspace-session-ownership";
import { createAgentSessionActivityPersistence } from "./agent-session-activity-persistence";
import { createAgentSessionLiveEnvelopePublisher } from "./agent-session-live-envelope";

let database: SqliteTaskStoreTestHarness;
beforeEach(async () => {
  database = await createSqliteTaskStoreHarness();
});
afterEach(async () => {
  await database.cleanup();
});

test("restore, metadata reads, and idle connection cleanup keep the saved date", async () => {
  const h = await setup();
  const existing = h.snapshot({ pendingQuestions: [{ requestId: "old", questions: [] }] });
  await h.observe({
    type: "snapshot",
    messageQueues: [],
    repoPath: h.ref.repoPath,
    sessions: [existing],
  });
  await h.observe(
    {
      type: "session_upsert",
      session: {
        ...existing,
        title: "Renamed",
        model: { providerId: "anthropic", modelId: "opus" },
      },
    },
    "baseline",
  );
  await h.transcript({ type: "session_started", message: "Restored" }, 9_000, "baseline");
  await h.transcript(
    { type: "assistant_message", messageId: "restored", message: "Old reply" },
    9_000,
    "baseline",
  );
  await h.transcript({ type: "session_status", status: { type: "idle" } }, 9_000);
  await h.transcript({ type: "session_finished", message: "Connection stopped" }, 10_000);
  await h.observe({ type: "session_removed", ref: h.ref });
  expect(h.writes).toEqual([]);
  expect((await h.saved()).lastActivityAt).toBe(2_000);
});

test("saves turn boundaries without writes for streamed text and keeps the date after restart", async () => {
  const h = await setup();
  await h.observe({
    type: "snapshot",
    messageQueues: [],
    repoPath: h.ref.repoPath,
    sessions: [h.snapshot()],
  });
  await h.transcript(
    { type: "user_message", messageId: "user", message: "Continue", parts: [], state: "read" },
    3_000,
  );
  for (let index = 0; index < 1_000; index++) {
    await h.transcript({ type: "assistant_delta", channel: "text", delta: "text" }, 4_000);
  }
  await h.transcript({ type: "assistant_message", messageId: "draft", message: "Draft" }, 5_000);
  await h.transcript({ type: "transcript_retracted", messageIds: ["draft"] }, 5_100);
  expect(h.writes).toEqual([3_000]);
  await h.transcript({ type: "assistant_message", messageId: "answer", message: "Done" }, 6_000);
  await h.observe({ type: "session_upsert", session: h.snapshot() });
  await h.transcript({ type: "session_idle", turnOutcome: "completed" }, 7_000);
  await h.transcript({ type: "session_status", status: { type: "idle" } }, 9_000);
  await h.transcript({ type: "session_finished", message: "Connection stopped" }, 10_000);
  expect(h.writes).toEqual([3_000, 6_000, 7_000]);
  expect(h.updates.at(-1)?.agentSessions[0]?.lastActivityAt).toBe(7_000);
  const restarted = h.restart();
  await Effect.runPromise(
    restarted.observe({
      type: "snapshot",
      messageQueues: [],
      repoPath: h.ref.repoPath,
      sessions: [h.snapshot()],
    }),
  );
  await Effect.runPromise(
    restarted.observe({ type: "session_upsert", session: h.snapshot() }, "baseline"),
  );
  expect((await h.saved()).lastActivityAt).toBe(7_000);
});

test("new input requests on subagents save the root date, but repeated requests and baselines do not", async () => {
  const h = await setup();
  const child = h.snapshot({
    ref: { ...h.ref, externalSessionId: "child" },
    parentExternalSessionId: h.ref.externalSessionId,
    activity: "running",
  });
  await h.observe({
    type: "snapshot",
    messageQueues: [],
    repoPath: h.ref.repoPath,
    sessions: [h.snapshot(), child],
  });
  const permission = {
    ...child,
    activity: "waiting_for_permission" as const,
    pendingApprovals: [
      { requestId: "permit", requestType: "command_execution" as const, title: "Run command" },
    ],
  };
  await h.observe({ type: "session_upsert", session: permission }, "live", 12_000);
  await h.observe({ type: "session_upsert", session: permission }, "live", 13_000);
  await h.observe(
    {
      type: "session_upsert",
      session: {
        ...child,
        activity: "waiting_for_question",
        pendingQuestions: [{ requestId: "ask", requestInstanceId: "first", questions: [] }],
      },
    },
    "live",
    14_000,
  );
  await h.observe(
    {
      type: "session_upsert",
      session: {
        ...child,
        activity: "waiting_for_question",
        pendingQuestions: [{ requestId: "ask", requestInstanceId: "second", questions: [] }],
      },
    },
    "live",
    15_000,
  );
  await h.observe({ type: "session_upsert", session: child }, "baseline", 16_000);
  expect(h.writes).toEqual([12_000, 14_000, 15_000]);
  expect((await h.saved()).lastActivityAt).toBe(15_000);
  await h.transcript({ type: "session_error", message: "Wrong directory" }, 20_000, "live", {
    ...h.ref,
    workingDirectory: "/another",
  });
  expect((await h.saved()).lastActivityAt).toBe(15_000);
});

test("saves foreground completion and final output before background activity becomes idle", async () => {
  const h = await setup();
  await h.observe({
    type: "session_upsert",
    session: h.snapshot({ activity: "running", foregroundTurnActive: true }),
  });
  await h.transcript(
    { type: "assistant_message", messageId: "answer", message: "Background work continues" },
    6_000,
  );
  expect(h.writes).toEqual([]);
  await h.transcript(
    {
      type: "session_turn_finished",
      completionId: "result",
      messageIds: [],
      turnOutcome: "completed",
    },
    7_000,
  );
  expect(h.writes).toEqual([7_000, 6_000]);
  expect((await h.saved()).lastActivityAt).toBe(7_000);
  await h.observe({
    type: "session_upsert",
    session: h.snapshot({ activity: "running", foregroundTurnActive: false }),
  });
  await h.transcript(
    {
      type: "session_status",
      status: { type: "busy", message: null },
      foregroundTurnActive: false,
    },
    8_000,
  );
  expect(h.writes).toEqual([7_000, 6_000]);
});

test("reports a failed activity save through the shared live channel", async () => {
  const h = await setup();
  const envelopes: AgentSessionLiveEnvelope[] = [];
  const persistence = createAgentSessionActivityPersistence({
    readTaskWorkspaces: () =>
      Effect.succeed([{ workspaceId: database.workspaceId, repoPath: database.repoPath }]),
    tasks: database.store,
    workspace: {
      observe: () => Effect.void,
      recordActivity: () =>
        Effect.fail(
          new HostOperationError({ operation: "save-activity", message: "Activity write failed." }),
        ),
    },
    publishTaskRecords: () => Effect.void,
  });
  const publish = createAgentSessionLiveEnvelopePublisher(
    (envelope) => {
      envelopes.push(envelope);
    },
    () => Effect.void,
    persistence,
  );
  const result = await Effect.runPromise(
    publish({
      type: "transcript_event",
      event: {
        type: "session_error",
        message: "Turn failed",
        externalSessionId: h.ref.externalSessionId,
        sessionRef: h.ref,
        timestamp: new Date(3_000).toISOString(),
      },
    }),
  );
  expect(result?.message).toContain("Activity write failed");
  expect(envelopes.at(-1)).toMatchObject({
    type: "fault",
    ref: h.ref,
    operation: "agent-session.persist",
    message: "Activity write failed.",
  });
  expect((await h.saved()).lastActivityAt).toBe(2_000);
});

test("updates each exact saved task association of a shared physical session", async () => {
  const h = await setup();
  const otherWorkspaceId = "other-workspace";
  await Effect.runPromise(
    database.withHostDatabase("test.duplicateSavedAssociation", (session) =>
      session.transaction("test.duplicateSavedAssociation", (transaction) =>
        Effect.gen(function* () {
          const [workspace] = yield* transaction.execute(
            (db) =>
              db.select().from(workspaces).where(eq(workspaces.workspaceId, database.workspaceId)),
            "test.workspace",
          );
          const [task] = yield* transaction.execute(
            (db) => db.select().from(tasks).where(eq(tasks.workspaceId, database.workspaceId)),
            "test.task",
          );
          const [record] = yield* transaction.execute(
            (db) =>
              db
                .select()
                .from(taskSessions)
                .where(eq(taskSessions.workspaceId, database.workspaceId)),
            "test.session",
          );
          if (!workspace || !task || !record)
            return yield* Effect.die(new Error("Missing saved fixture association."));
          yield* transaction.execute(
            (db) => db.insert(workspaces).values({ ...workspace, workspaceId: otherWorkspaceId }),
            "test.otherWorkspace",
          );
          yield* transaction.execute(
            (db) => db.insert(tasks).values({ ...task, workspaceId: otherWorkspaceId }),
            "test.otherTask",
          );
          yield* transaction.execute(
            (db) => db.insert(taskSessions).values({ ...record, workspaceId: otherWorkspaceId }),
            "test.otherSession",
          );
        }),
      ),
    ),
  );
  const published: string[] = [];
  const persistence = createAgentSessionActivityPersistence({
    tasks: database.store,
    readTaskWorkspaces: () =>
      Effect.succeed(
        [database.workspaceId, otherWorkspaceId].map((workspaceId) => ({
          workspaceId,
          repoPath: database.repoPath,
        })),
      ),
    workspace: { observe: () => Effect.void, recordActivity: () => Effect.succeed(true) },
    publishTaskRecords: (scope) => Effect.sync(() => void published.push(scope.workspaceId)),
  });
  await Effect.runPromise(
    persistence.observe(
      {
        type: "transcript_event",
        event: {
          type: "session_error",
          sessionRef: h.ref,
          externalSessionId: h.ref.externalSessionId,
          timestamp: new Date(3_000).toISOString(),
          message: "The native session failed.",
        },
      },
      "live",
    ),
  );
  const records = await Effect.runPromise(
    database.withHostDatabase("test.savedActivity", (session) =>
      session.execute(
        (db) =>
          db
            .select({
              workspaceId: taskSessions.workspaceId,
              lastActivityAt: taskSessions.lastActivityAt,
            })
            .from(taskSessions),
        "test.savedActivity",
      ),
    ),
  );
  expect(records).toEqual([
    { workspaceId: database.workspaceId, lastActivityAt: 3_000 },
    { workspaceId: otherWorkspaceId, lastActivityAt: 3_000 },
  ]);
  expect(published).toEqual([database.workspaceId, otherWorkspaceId]);
});

type EventInput = AgentSessionTranscriptEvent extends infer Event
  ? Event extends AgentSessionTranscriptEvent
    ? Omit<Event, "sessionRef" | "externalSessionId" | "timestamp">
    : never
  : never;

const setup = async () => {
  const task = await Effect.runPromise(
    database.store.createTask({
      workspaceId: database.workspaceId,
      repoPath: database.repoPath,
      status: "open",
      task: { title: "Activity", issueType: "task", priority: 2 },
    }),
  );
  const session = createAgentSessionRecord({
    runtimeKind: "claude",
    startedAt: new Date(1_000).toISOString(),
    lastActivityAt: 2_000,
  });
  await Effect.runPromise(
    database.store.upsertAgentSession({
      workspaceId: database.workspaceId,
      repoPath: database.repoPath,
      ownershipScope: workspaceSessionOwnership({
        workspaceId: database.workspaceId,
        repoPath: database.repoPath,
      }),
      taskId: task.id,
      session,
    }),
  );
  const ref = {
    repoPath: database.repoPath,
    runtimeKind: session.runtimeKind,
    workingDirectory: session.workingDirectory,
    externalSessionId: session.externalSessionId,
  };
  const updates: TaskAgentSessions[] = [];
  const writes: number[] = [];
  const restart = () =>
    createAgentSessionActivityPersistence({
      readTaskWorkspaces: () =>
        Effect.succeed([{ workspaceId: database.workspaceId, repoPath: database.repoPath }]),
      tasks: {
        recordAgentSessionActivity: (input) => {
          writes.push(input.occurredAt);
          return database.store.recordAgentSessionActivity(input);
        },
      },
      workspace: { observe: () => Effect.void, recordActivity: () => Effect.succeed(false) },
      publishTaskRecords: (_repoPath, records) =>
        Effect.sync(() => {
          updates.push(records);
        }),
    });
  const persistence = restart();
  const observe = (
    envelope: AgentSessionLiveEnvelope,
    provenance: "baseline" | "live" = "live",
    now?: number,
  ) =>
    Effect.runPromise(
      now === undefined
        ? persistence.observe(envelope, provenance)
        : TestClock.setTime(now).pipe(
            Effect.andThen(persistence.observe(envelope, provenance)),
            Effect.provide(TestClock.layer()),
          ),
    );
  return {
    ref,
    writes,
    updates,
    restart,
    observe,
    transcript: (
      event: EventInput,
      at: number,
      provenance: "baseline" | "live" = "live",
      sessionRef = ref,
    ) =>
      observe(
        {
          type: "transcript_event",
          event: {
            ...event,
            sessionRef,
            externalSessionId: sessionRef.externalSessionId,
            timestamp: new Date(at).toISOString(),
          },
        },
        provenance,
      ),
    snapshot: (overrides: Partial<AgentSessionLiveSnapshot> = {}): AgentSessionLiveSnapshot => ({
      ref,
      title: "Activity",
      startedAt: session.startedAt,
      activity: "idle",
      pendingApprovals: [],
      pendingQuestions: [],
      contextUsage: null,
      ...overrides,
    }),
    saved: async () =>
      (
        await Effect.runPromise(
          database.store.listAgentSessionsForTasks({
            workspaceId: database.workspaceId,
            repoPath: database.repoPath,
            taskIds: [task.id],
          }),
        )
      )[0]!.agentSessions[0]!,
  };
};
