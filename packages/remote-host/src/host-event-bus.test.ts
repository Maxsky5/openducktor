import { expect, test } from "bun:test";
import type { HostEventEnvelope } from "@openducktor/contracts";
import { BufferedHostEventStream } from "./host-event-bus";
import { liveSessionStreamEventName } from "@openducktor/host-client";

const liveEvent = (repoPath: string, index: number): HostEventEnvelope => ({
  channel: "openducktor://agent-session-live-event",
  payload: { type: "fault", repoPath, operation: "test", message: `fault ${index}` },
});

test("a byte limit evicts large events and reports their gap", () => {
  const host = new BufferedHostEventStream({ events: 100, bytes: 300, totalBytes: 1024 * 1024 });
  for (let index = 0; index < 4; index++) host.emit(liveEvent("/repo", index), () => {});

  const replay = host.replayAfter(0);
  expect(replay.events.map((event) => event.id)).toEqual([3, 4]);
  expect(replay.gaps).toEqual([liveSessionStreamEventName("/repo")]);
  expect(host.replayAfter(2).gaps).toEqual([]);
});

test("a total byte limit evicts the oldest events of any event name", () => {
  const eventBytes = Buffer.byteLength(JSON.stringify(liveEvent("/a", 0)));
  const host = new BufferedHostEventStream({
    events: 100,
    bytes: 1024 * 1024,
    totalBytes: eventBytes * 3,
  });
  host.emit(liveEvent("/a", 0), () => {});
  host.emit(liveEvent("/b", 1), () => {});
  host.emit(liveEvent("/a", 2), () => {});
  host.emit(liveEvent("/c", 3), () => {});
  host.emit(liveEvent("/c", 4), () => {});

  const replay = host.replayAfter(0);
  expect(replay.events.map((event) => event.id)).toEqual([3, 4, 5]);
  expect(replay.gaps.toSorted()).toEqual(
    [liveSessionStreamEventName("/a"), liveSessionStreamEventName("/b")].toSorted(),
  );
  expect(host.replayAfter(2).gaps).toEqual([]);
});
