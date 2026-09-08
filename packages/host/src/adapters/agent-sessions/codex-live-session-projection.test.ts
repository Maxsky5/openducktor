import { expect, spyOn, test } from "bun:test";
import type { AgentSessionLiveSnapshot } from "@openducktor/contracts";
import { Effect } from "effect";
import { createCodexLiveSessionProjection } from "./codex-live-session-projection";

const snapshot = (externalSessionId: string): AgentSessionLiveSnapshot => ({
  ref: { repoPath: "/repo", workingDirectory: "/repo", runtimeKind: "codex", externalSessionId },
  activity: "idle",
  title: externalSessionId,
  startedAt: "2026-07-16T10:00:00.000Z",
  pendingApprovals: [],
  pendingQuestions: [],
  contextUsage: null,
});

test("empty deltas retain idle sessions and only explicit removals delete them", async () => {
  const projection = createCodexLiveSessionProjection({
    runtime: { runtimeId: "runtime", repoPath: "/repo", workingDirectory: "/repo" },
    liveSessionLifecycle: {
      runAdapterMutation: (mutation) => mutation.pipe(Effect.map((result) => result.value)),
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
  expect(await Effect.runPromise(projection.listSnapshots("/repo"))).toEqual(sessions);
  await Effect.runPromise(
    projection.applyMutation({
      ...base,
      snapshotMode: "delta",
      snapshots: [],
      removedRefs: [sessions[0]!.ref],
    }),
  );
  expect(await Effect.runPromise(projection.listSnapshots("/repo"))).toEqual(sessions.slice(1));
});

test("invalid removal refs reject the whole delta before any state changes", async () => {
  const projection = createCodexLiveSessionProjection({
    runtime: { runtimeId: "runtime", repoPath: "/repo", workingDirectory: "/repo" },
    liveSessionLifecycle: {
      runAdapterMutation: (mutation) => mutation.pipe(Effect.map((result) => result.value)),
    },
  });
  const base = { runtimeId: "runtime", transcriptEvents: [], catalogInvalidated: false };
  const initial = snapshot("thread-0");
  await Effect.runPromise(
    projection.applyMutation({ ...base, snapshotMode: "full", snapshots: [initial] }),
  );
  for (const ref of [
    { ...initial.ref, repoPath: "/other" },
    { ...initial.ref, runtimeKind: "opencode" as const },
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
    ).rejects.toThrow("removedRefs");
    expect(await Effect.runPromise(projection.listSnapshots("/repo"))).toEqual([initial]);
  }
});

test("text deltas preserve transcript order with zero snapshot equality serializations", () => {
  const transcript: string[] = [];
  const projection = createCodexLiveSessionProjection({
    runtime: { runtimeId: "runtime", repoPath: "/repo", workingDirectory: "/repo" },
    liveSessionLifecycle: {
      runAdapterMutation: (mutation) =>
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
