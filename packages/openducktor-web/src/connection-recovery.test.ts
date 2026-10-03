import { expect, test } from "bun:test";
import type { HostEventEnvelope } from "@openducktor/contracts";
import { BufferedHostEventStream } from "./typescript-host-backend-support";

const transcript = (repoPath: string, sessionId: string): HostEventEnvelope => ({
  channel: "openducktor://agent-session-live-event",
  payload: {
    type: "transcript_event",
    event: {
      type: "assistant_message",
      externalSessionId: sessionId,
      messageId: sessionId,
      message: "output",
      timestamp: "2026-09-30T10:00:00Z",
      sessionRef: {
        repoPath,
        runtimeKind: "codex",
        workingDirectory: repoPath,
        externalSessionId: sessionId,
      },
    },
  },
});
const emit = (stream: BufferedHostEventStream, event: HostEventEnvelope) =>
  stream.emit(event, (cause) => {
    throw cause;
  });

test("other channel overflow cannot evict agent transcript replay", () => {
  const stream = new BufferedHostEventStream(2);
  emit(stream, transcript("/first", "one"));
  for (let index = 0; index < 1000; index++)
    emit(stream, { channel: "openducktor://run-event", payload: { index } });
  const replay = stream.replayAfterWithDiagnostics(`${stream.hostEpoch}:0`);
  expect(replay.events.map((event) => event.id)).toEqual([1, 1000, 1001]);
  expect(replay.boundary.losses).toEqual([{ channel: "openducktor://run-event", facet: "other" }]);
});

test("transcript overflow identifies the exact session and workspace", () => {
  const stream = new BufferedHostEventStream(2);
  emit(stream, transcript("/first", "one"));
  emit(stream, transcript("/second", "two"));
  emit(stream, transcript("/second", "three"));
  const replay = stream.replayAfterWithDiagnostics(`${stream.hostEpoch}:0`);
  expect(replay.boundary.losses).toEqual([
    {
      channel: "openducktor://agent-session-live-event",
      repoPath: "/first",
      facet: "transcript",
      refs: [
        {
          repoPath: "/first",
          runtimeKind: "codex",
          workingDirectory: "/first",
          externalSessionId: "one",
        },
      ],
    },
  ]);
  expect(replay.events.map((event) => event.id)).toEqual([2, 3]);
  expect(stream.replayAfterWithDiagnostics(`${stream.hostEpoch}:1`).boundary.losses).toEqual([]);
});

test("host replacement invalidates continuity and rejects malformed or future cursors", () => {
  const previous = new BufferedHostEventStream(2);
  const current = new BufferedHostEventStream(2);
  expect(current.replayAfterWithDiagnostics(`${previous.hostEpoch}:0`).boundary.hostChanged).toBe(
    true,
  );
  expect(() => current.replayAfterWithDiagnostics("bad-cursor")).toThrow("Reload the browser");
  expect(() => current.replayAfterWithDiagnostics(`${current.hostEpoch}:1`)).toThrow(
    "ahead of the host",
  );
});

test("compacted loss detail remains conservative after many session evictions", () => {
  const stream = new BufferedHostEventStream(1);
  for (let index = 0; index < 800; index++)
    emit(stream, transcript(`/repo-${index}`, `session-${index}`));
  const losses = stream.replayAfterWithDiagnostics(`${stream.hostEpoch}:0`).boundary.losses;
  expect(losses.length).toBeLessThanOrEqual(512);
  expect(losses).toContainEqual({
    channel: "openducktor://agent-session-live-event",
    facet: "transcript",
  });
});
