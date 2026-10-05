import {
  type AgentSessionLiveAdapterChange,
  AgentSessionLiveRegistration,
} from "../../ports/agent-session-live-adapter-port";
import { expect, spyOn, test } from "bun:test";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { Effect } from "effect";
import { createCodexLiveSessionProjection } from "./codex-live-session-projection";

const snapshot = (externalSessionId: string, repoPath = "/repo"): AgentSessionLiveSnapshot => ({
  ref: { repoPath, workingDirectory: repoPath, runtimeKind: "codex", externalSessionId },
  activity: "idle",
  title: externalSessionId,
  startedAt: "2026-07-16T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
});

test("empty deltas retain idle sessions and only explicit removals delete them", async () => {
  const projection = createCodexLiveSessionProjection({
    runtime: { runtimeId: "runtime" },
    liveSessionLifecycle: {
      createRuntimeRegistration: (binding) =>
        new AgentSessionLiveRegistration(binding, (mutation) =>
          mutation.pipe(Effect.map((result) => result.value)),
        ),
    },
  });
  const base = { runtimeId: "runtime", transcriptEvents: [], catalogInvalidated: false };
  const sessions = Array.from({ length: 50 }, (_, index) => snapshot(`thread-${index}`));
  await Effect.runPromise(
    projection.applyMutation({ ...base, snapshotMode: "full", snapshots: sessions }),
  );
  for (let index = 0; index < 100; index++) {
    await Effect.runPromise(
      projection.applyMutation({ ...base, snapshotMode: "delta", snapshots: [], removedRefs: [] }),
    );
  }
  expect(await Effect.runPromise(projection.listSnapshots())).toEqual(sessions);
  await Effect.runPromise(
    projection.applyMutation({
      ...base,
      snapshotMode: "delta",
      snapshots: [],
      removedRefs: [sessions[0]!.ref],
    }),
  );
  expect(await Effect.runPromise(projection.listSnapshots())).toEqual(sessions.slice(1));
});

test("invalid removal refs reject the whole delta before any state changes", async () => {
  const projection = createCodexLiveSessionProjection({
    runtime: { runtimeId: "runtime" },
    liveSessionLifecycle: {
      createRuntimeRegistration: (binding) =>
        new AgentSessionLiveRegistration(binding, (mutation) =>
          mutation.pipe(Effect.map((result) => result.value)),
        ),
    },
  });
  const base = { runtimeId: "runtime", transcriptEvents: [], catalogInvalidated: false };
  const initial = snapshot("thread-0");
  await Effect.runPromise(
    projection.applyMutation({ ...base, snapshotMode: "full", snapshots: [initial] }),
  );
  for (const { ref, message } of [
    { ref: { ...initial.ref, externalSessionId: "" }, message: "externalSessionId" },
    { ref: { ...initial.ref, runtimeKind: "opencode" as const }, message: "removedRefs" },
  ]) {
    await expect(
      Effect.runPromise(
        projection.applyMutation({
          ...base,
          snapshotMode: "delta",
          snapshots: [{ ...initial, title: "must not commit" }],
          removedRefs: [ref],
        }),
      ),
    ).rejects.toThrow(message);
    expect(await Effect.runPromise(projection.listSnapshots())).toEqual([initial]);
  }
});

const recordingProjection = (changes: AgentSessionLiveAdapterChange[]) =>
  createCodexLiveSessionProjection({
    runtime: { runtimeId: "runtime" },
    liveSessionLifecycle: {
      createRuntimeRegistration: (binding) =>
        new AgentSessionLiveRegistration(binding, (mutation) =>
          mutation.pipe(
            Effect.map((result) => {
              changes.push(...result.changes);
              return result.value;
            }),
          ),
        ),
    },
  });

test("keeps the sessions of every repository on the shared runtime", async () => {
  const changes: AgentSessionLiveAdapterChange[] = [];
  const projection = recordingProjection(changes);
  const base = { runtimeId: "runtime", transcriptEvents: [], catalogInvalidated: false };
  const repoA = snapshot("thread-a", "/repo-a");
  const repoB = snapshot("thread-b", "/repo-b");

  await Effect.runPromise(
    projection.applyMutation({ ...base, snapshotMode: "full", snapshots: [repoA, repoB] }),
  );
  await Effect.runPromise(
    projection.applyMutation({
      ...base,
      snapshotMode: "delta",
      snapshots: [{ ...repoB, activity: "running" }],
      removedRefs: [],
    }),
  );

  expect(await Effect.runPromise(projection.listSnapshots())).toEqual([
    repoA,
    { ...repoB, activity: "running" },
  ]);
  expect(projection.hasSnapshot(repoA.ref)).toBe(true);
  expect(changes.filter((change) => change.type === "session_removed")).toEqual([]);

  // A full projection lists every owned session, so it removes only sessions that ended.
  await Effect.runPromise(
    projection.applyMutation({ ...base, snapshotMode: "full", snapshots: [repoA] }),
  );
  expect(await Effect.runPromise(projection.listSnapshots())).toEqual([repoA]);
  expect(changes.filter((change) => change.type === "session_removed")).toEqual([
    { type: "session_removed", ref: repoB.ref },
  ]);
});

test("routes runtime-wide changes to each repository with a live session", async () => {
  const changes: AgentSessionLiveAdapterChange[] = [];
  const projection = recordingProjection(changes);
  const base = { runtimeId: "runtime", transcriptEvents: [], catalogInvalidated: false };
  const repoA = snapshot("thread-a", "/repo-a");
  const repoB = snapshot("thread-b", "/repo-b");
  const repoAOther = snapshot("thread-a2", "/repo-a");

  await Effect.runPromise(
    projection.applyMutation({
      ...base,
      snapshotMode: "delta",
      snapshots: [],
      removedRefs: [],
      catalogInvalidated: true,
      fault: "No live session",
    }),
  );
  expect(changes).toEqual([]);

  await Effect.runPromise(
    projection.applyMutation({
      ...base,
      snapshotMode: "full",
      snapshots: [repoA, repoB, repoAOther],
    }),
  );
  changes.length = 0;
  await Effect.runPromise(
    projection.applyMutation({
      ...base,
      snapshotMode: "delta",
      snapshots: [],
      removedRefs: [],
      catalogInvalidated: true,
      fault: "Runtime event failed",
    }),
  );
  await Effect.runPromise(
    projection.applyMutation({
      ...base,
      snapshotMode: "delta",
      snapshots: [],
      removedRefs: [],
      fault: "Session event failed",
      faultRef: repoB.ref,
    }),
  );

  const operation = "codex-live-session.process-event";
  expect(changes).toEqual([
    { type: "catalog_invalidated", repoPath: "/repo-a", runtimeKind: "codex" },
    { type: "catalog_invalidated", repoPath: "/repo-b", runtimeKind: "codex" },
    { type: "fault", repoPath: "/repo-a", operation, message: "Runtime event failed" },
    { type: "fault", repoPath: "/repo-b", operation, message: "Runtime event failed" },
    {
      type: "fault",
      repoPath: "/repo-b",
      operation,
      message: "Session event failed",
      ref: repoB.ref,
    },
  ]);
});

test("invalidates the catalog of a repository that the runtime served without a live session", async () => {
  const changes: AgentSessionLiveAdapterChange[] = [];
  const projection = recordingProjection(changes);
  const base = { runtimeId: "runtime", transcriptEvents: [], catalogInvalidated: false };
  await Effect.runPromise(
    projection.applyMutation({
      ...base,
      snapshotMode: "full",
      snapshots: [snapshot("a", "/repo-a")],
    }),
  );
  projection.recordCatalogRepository("/repo-b");
  projection.recordCatalogRepository("/repo-a");
  changes.length = 0;

  await Effect.runPromise(
    projection.applyMutation({
      ...base,
      snapshotMode: "delta",
      snapshots: [],
      removedRefs: [],
      catalogInvalidated: true,
    }),
  );

  expect(changes).toEqual([
    { type: "catalog_invalidated", repoPath: "/repo-a", runtimeKind: "codex" },
    { type: "catalog_invalidated", repoPath: "/repo-b", runtimeKind: "codex" },
  ]);
});

test("text deltas preserve transcript order with zero snapshot equality serializations", () => {
  const transcript: string[] = [];
  const projection = createCodexLiveSessionProjection({
    runtime: { runtimeId: "runtime" },
    liveSessionLifecycle: {
      createRuntimeRegistration: (binding) =>
        new AgentSessionLiveRegistration(binding, (mutation) =>
          mutation.pipe(
            Effect.map((result) => {
              for (const change of result.changes) {
                if (change.type === "transcript_event" && change.event.type === "assistant_delta") {
                  transcript.push(change.event.delta);
                }
              }
              return result.value;
            }),
          ),
        ),
    },
  });
  const base = { runtimeId: "runtime", transcriptEvents: [], catalogInvalidated: false };
  const sessions = Array.from({ length: 50 }, (_, index) => snapshot(`thread-${index}`));
  Effect.runSync(projection.applyMutation({ ...base, snapshotMode: "full", snapshots: sessions }));
  const serialize = JSON.stringify;
  // This spy stays inside synchronous Effects, so another test cannot run while it is active.
  const stringify = spyOn(JSON, "stringify");
  try {
    for (let index = 0; index < 100; index++) {
      Effect.runSync(
        projection.applyMutation({ ...base, snapshotMode: "full", snapshots: sessions }),
      );
    }
    expect(stringify).toHaveBeenCalledTimes(10_000);
    const baselineBytes = stringify.mock.calls.reduce(
      (bytes, [value]) => bytes + Buffer.byteLength(serialize(value)),
      0,
    );
    stringify.mockClear();
    for (let index = 0; index < 100; index++) {
      Effect.runSync(
        projection.applyMutation({
          ...base,
          snapshotMode: "delta",
          snapshots: [],
          removedRefs: [],
          transcriptEvents: [
            {
              type: "assistant_delta",
              channel: "text",
              sessionRef: sessions[0]!.ref,
              externalSessionId: "thread-0",
              timestamp: "2026-07-16T10:00:00.000Z",
              messageId: "message-0",
              delta: `${index},`,
            },
          ],
        }),
      );
    }
    const snapshotSerializations = stringify.mock.calls.filter(([value]) =>
      Object.hasOwn(value ?? {}, "ref"),
    );
    expect(snapshotSerializations).toEqual([]);
    expect(transcript).toEqual(Array.from({ length: 100 }, (_, index) => `${index},`));
    console.info(
      `Codex host text replay: equality calls 10000 -> 0; serialized bytes ${baselineBytes} -> 0`,
    );
  } finally {
    stringify.mockRestore();
  }
});
