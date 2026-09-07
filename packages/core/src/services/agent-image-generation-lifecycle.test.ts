import { expect, test } from "bun:test";
import { settleAgentImageGeneration } from "./agent-image-generation";
import {
  reduceAgentImageGenerationLifecycle as reduce,
  resolveAgentImageGenerationSettlement as resolve,
  type AgentImageGenerationLifecycle,
} from "./agent-image-generation-lifecycle";

const timestamp = "2026-09-06T10:00:00.000Z";

test("runtime failure replaces idle and survives later turn and session idle events", () => {
  const idle = reduce({}, { type: "turn_ended", turnId: "turn", reason: "turn_ended" });
  const failed = reduce(idle, { type: "turn_ended", turnId: "turn", reason: "runtime_failure" });
  expect(resolve(failed, { turnId: "turn" }, "turn")).toBe("runtime_failure");
  expect(reduce(failed, { type: "turn_ended", turnId: "turn", reason: "turn_ended" })).toBe(failed);
  const sessionIdle = reduce(failed, {
    type: "session_ended",
    timestamp,
    reason: "turn_ended",
    turnIds: ["turn"],
  });
  expect(resolve(sessionIdle, { turnId: "turn" }, "session")).toBe("runtime_failure");
  const interrupted = reduce(failed, { type: "turn_ended", turnId: "turn", reason: "interrupted" });
  expect(resolve(interrupted, { turnId: "turn" }, "turn")).toBe("interrupted");
});

for (const reason of ["turn_ended", "runtime_failure", "interrupted"] as const) {
  test(`${reason} survives late starts without ending another turn`, () => {
    const before = reduce({}, { type: "turn_started", turnId: "old" });
    const ended = reduce(before, { type: "turn_ended", turnId: "old", reason });
    expect(before.turnEnds?.size).toBe(0);
    expect(before.turnStarts?.has("old")).toBe(true);
    expect(ended.turnStarts?.has("old")).toBe(false);
    expect(reduce(ended, { type: "turn_started", turnId: "old" })).toBe(ended);
    expect(resolve(ended, { turnId: "old" }, "turn")).toBe(reason);
    expect(resolve(ended, { turnId: "next" }, "turn")).toBeUndefined();
    expect(reduce(ended, { type: "turn_ended", turnId: "old", reason })).toBe(ended);
  });
}

test("interruption takes priority over provisional turn and session ends", () => {
  let state = reduce({}, { type: "turn_ended", turnId: "turn", reason: "turn_ended" });
  state = reduce(state, { type: "turn_ended", turnId: "turn", reason: "interrupted" });
  expect(reduce(state, { type: "turn_ended", turnId: "turn", reason: "runtime_failure" })).toBe(
    state,
  );
  state = reduce(state, {
    type: "session_ended",
    timestamp,
    reason: "runtime_failure",
    turnIds: ["turn"],
  });
  expect(resolve(state, { turnId: "turn" }, "session")).toBe("interrupted");
});

test("session end covers known and started turns and preserves a later turn", () => {
  const started = reduce({}, { type: "turn_started", turnId: "started" });
  const ended = reduce(started, {
    type: "session_ended",
    timestamp,
    reason: "turn_ended",
    turnIds: ["known"],
  });
  expect(ended.turnStarts?.size).toBe(0);
  for (const turnId of ["started", "known"])
    expect(resolve(ended, { turnId, timestamp: "2026-09-06T11:00:00.000Z" }, "session")).toBe(
      "turn_ended",
    );
  expect(resolve(ended, {}, "session")).toBe("turn_ended");
  expect(resolve(ended, { timestamp }, "session")).toBe("turn_ended");
  expect(resolve(ended, { timestamp: "2026-09-06T10:00:01.000Z" }, "session")).toBeUndefined();
  expect(resolve(ended, {}, "turn")).toBeUndefined();
  const next = reduce(ended, { type: "turn_started", turnId: "next" });
  expect(resolve(next, { turnId: "next" }, "session")).toBeUndefined();
  expect(resolve(ended, { turnId: "next" }, "session")).toBe("turn_ended");
  const stopped = reduce(next, {
    type: "session_ended",
    timestamp,
    reason: "runtime_failure",
    turnIds: [],
  });
  expect(resolve(stopped, { turnId: "next" }, "session")).toBe("runtime_failure");
});

test("native image outcomes survive lifecycle settlement", () => {
  const state: AgentImageGenerationLifecycle = reduce(
    {},
    {
      type: "turn_ended",
      turnId: "turn",
      reason: "interrupted",
    },
  );
  const reason = resolve(state, { turnId: "turn" }, "turn")!;
  for (const status of ["completed", "failed"] as const) {
    const part = {
      kind: "image_generation" as const,
      itemId: "image",
      messageId: "image",
      partId: "image",
      turnId: "turn",
      status,
    };
    expect(settleAgentImageGeneration(part, reason)).toBe(part);
  }
});

test("later idle keeps the failure cutoff without applying it to newer unseen images", () => {
  const failed = reduce(
    {},
    {
      type: "session_ended",
      timestamp,
      reason: "runtime_failure",
      turnIds: [],
    },
  );
  const idle = reduce(failed, {
    type: "session_ended",
    timestamp: "2026-09-06T11:00:00.000Z",
    reason: "turn_ended",
    turnIds: [],
  });
  expect(resolve(idle, { timestamp: "2026-09-06T09:00:00.000Z" }, "session")).toBe(
    "runtime_failure",
  );
  expect(resolve(idle, { timestamp }, "session")).toBe("runtime_failure");
  expect(resolve(idle, { timestamp: "2026-09-06T10:30:00.000Z" }, "session")).toBe("turn_ended");
  expect(resolve(idle, { timestamp: "2026-09-06T12:00:00.000Z" }, "session")).toBeUndefined();
  expect(resolve(idle, {}, "session")).toBe("turn_ended");
  expect(resolve(idle, { timestamp }, "turn")).toBeUndefined();
  const next = reduce(idle, { type: "turn_started", turnId: "next" });
  expect(resolve(next, { turnId: "next", timestamp }, "session")).toBeUndefined();
  const ended = reduce(next, { type: "turn_ended", turnId: "next", reason: "interrupted" });
  expect(resolve(ended, { turnId: "next", timestamp }, "session")).toBe("interrupted");
});

test("session interruption takes priority over an older failure cutoff", () => {
  const failed = reduce(
    {},
    { type: "session_ended", timestamp, reason: "runtime_failure", turnIds: [] },
  );
  const interrupted = reduce(failed, {
    type: "session_ended",
    timestamp: "2026-09-06T11:00:00.000Z",
    reason: "interrupted",
    turnIds: [],
  });
  expect(resolve(interrupted, { timestamp }, "session")).toBe("interrupted");
});
