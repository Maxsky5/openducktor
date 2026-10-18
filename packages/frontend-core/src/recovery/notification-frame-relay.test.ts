import { expect, mock, test } from "bun:test";
import type { NotificationStreamFrame } from "@openducktor/contracts";
import { createNotificationFrameRelay } from "./notification-frame-relay";
const epoch = "11111111-1111-4111-8111-111111111111";
const attached = (): NotificationStreamFrame => ({
  type: "attached",
  reason: "new",
  cursor: { epoch, sequence: 0 },
  health: [],
});
const healthFrame = (sequence: number, message: string | null = null): NotificationStreamFrame => ({
  type: "health",
  cursor: { epoch, sequence },
  health: { scope: "/repo", source: "session", message },
});
test("an early consumer receives the host attachment and late consumers seed silently", () => {
  const relay = createNotificationFrameRelay();
  const early = mock((_frame: NotificationStreamFrame) => {});
  const stop = relay.subscribe({ cursor: null }, early, () => {});
  expect(early).not.toHaveBeenCalled();
  relay.accept(attached());
  relay.accept(healthFrame(1, "Runtime unavailable"));
  const late = mock((_frame: NotificationStreamFrame) => {});
  const stopLate = relay.subscribe({ cursor: null }, late, () => {});
  expect(late.mock.calls).toEqual([
    [
      {
        type: "attached",
        reason: "new",
        cursor: { epoch, sequence: 1 },
        health: [{ scope: "/repo", source: "session", message: "Runtime unavailable" }],
      },
    ],
  ]);
  relay.accept(healthFrame(2));
  expect(early).toHaveBeenCalledTimes(3);
  expect(late).toHaveBeenCalledTimes(2);
  stop();
  stopLate();
  expect(relay.hasListeners()).toBe(false);
});
test("late consumers can replay a bounded cursor range and gaps remain explicit", () => {
  const relay = createNotificationFrameRelay();
  relay.accept(attached());
  for (let sequence = 1; sequence <= 300; sequence++) relay.accept(healthFrame(sequence));
  const frames: NotificationStreamFrame[] = [];
  relay.subscribe(
    { cursor: { epoch, sequence: 44 } },
    (frame) => frames.push(frame),
    () => {},
  );
  expect(frames).toHaveLength(257);
  expect(frames[0]).toMatchObject({
    type: "attached",
    reason: "replay",
    cursor: { epoch, sequence: 44 },
  });
  expect(frames.at(-1)?.cursor.sequence).toBe(300);
  const gap = mock((_frame: NotificationStreamFrame) => {});
  relay.subscribe({ cursor: { epoch, sequence: 43 } }, gap, () => {});
  expect(gap).toHaveBeenCalledTimes(1);
  expect(gap.mock.calls[0]).toEqual([
    { type: "attached", reason: "gap", cursor: { epoch, sequence: 300 }, health: [] },
  ]);
});
test("reconnect replaces health and retained frames with the new host epoch", () => {
  const relay = createNotificationFrameRelay();
  relay.accept(attached());
  relay.accept(healthFrame(1, "Old failure"));
  const newEpoch = crypto.randomUUID();
  relay.accept({
    type: "attached",
    reason: "epoch_changed",
    cursor: { epoch: newEpoch, sequence: 0 },
    health: [],
  });
  const frames: NotificationStreamFrame[] = [];
  relay.subscribe(
    { cursor: { epoch, sequence: 1 } },
    (frame) => frames.push(frame),
    () => {},
  );
  expect(frames).toEqual([
    {
      type: "attached",
      reason: "epoch_changed",
      cursor: { epoch: newEpoch, sequence: 0 },
      health: [],
    },
  ]);
});
test("a throwing consumer is detached without affecting another consumer", () => {
  const relay = createNotificationFrameRelay();
  const failure = mock(() => {});
  const healthy = mock(() => {});
  relay.subscribe(
    { cursor: null },
    () => {
      throw new Error("Consumer failed");
    },
    failure,
  );
  relay.subscribe({ cursor: null }, healthy, () => {});
  relay.accept(attached());
  relay.accept(healthFrame(1));
  expect(failure).toHaveBeenCalledTimes(1);
  expect(healthy).toHaveBeenCalledTimes(2);
});
