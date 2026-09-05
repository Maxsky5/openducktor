const timestamp = "2026-09-06T10:00:00.000Z";
import { expect, test } from "bun:test";
import type { AgentImageGenerationPart } from "@openducktor/contracts";
import { CodexImageGenerationState } from "./codex-image-generation-state";

const part = (itemId: string, turnId = "turn"): AgentImageGenerationPart => ({
  kind: "image_generation",
  itemId,
  messageId: itemId,
  partId: itemId,
  turnId,
  status: "running",
});

test("settlement only affects active images in the exact runtime, session, and turn", () => {
  const state = new CodexImageGenerationState();
  state.upsert("runtime", "thread", part("one"));
  state.upsert("runtime", "thread", part("two", "other-turn"));
  state.upsert("runtime", "thread", { ...part("done"), status: "completed" });
  state.upsert("other-runtime", "thread", part("one"));
  state.upsert("runtime", "other-thread", part("one"));
  expect(state.settle("runtime", "thread", "turn", "interrupted", timestamp)).toEqual([
    { ...part("one"), status: "interrupted" },
  ]);
  expect(state.upsert("runtime", "thread", part("one")).status).toBe("interrupted");
  expect(state.settle("runtime", "thread", undefined, "runtime_failure", timestamp)).toEqual([
    { ...part("two", "other-turn"), status: "incomplete", incompleteReason: "runtime_failure" },
  ]);
  expect(state.settle("other-runtime", "thread", undefined, "turn_ended", timestamp)).toHaveLength(
    1,
  );
  expect(state.settle("runtime", "other-thread", undefined, "turn_ended", timestamp)).toHaveLength(
    1,
  );
});

test("late completion wins, duplicate IDs stay stable, and cleanup removes runtime state", () => {
  const state = new CodexImageGenerationState();
  state.upsert("runtime", "thread", part("one"));
  state.upsert("runtime", "thread", part("one"));
  state.upsert("runtime", "thread", part("two"));
  expect(state.settle("runtime", "thread", "turn", "turn_ended", timestamp)).toHaveLength(2);
  expect(state.upsert("runtime", "thread", { ...part("one"), status: "completed" }).status).toBe(
    "completed",
  );
  expect(state.upsert("runtime", "thread", part("one")).status).toBe("completed");
  state.clearSession("thread", "runtime");
  expect(state.upsert("runtime", "thread", part("one")).status).toBe("running");
  state.clearRuntime("runtime");
  expect(state.settle("runtime", "thread", undefined, "runtime_failure", timestamp)).toEqual([]);
});

test("a confirmed interruption replaces provisional idle settlement", () => {
  const state = new CodexImageGenerationState();
  state.upsert("runtime", "thread", part("one"));
  state.settle("runtime", "thread", "turn", "turn_ended", timestamp);
  expect(state.settle("runtime", "thread", "turn", "interrupted", timestamp)).toEqual([
    { ...part("one"), status: "interrupted" },
  ]);
});

test("a terminal turn protects a delayed first start while allowing the next turn", () => {
  const state = new CodexImageGenerationState();
  state.settle("runtime", "thread", "turn", "interrupted", timestamp);
  expect(state.upsert("runtime", "thread", part("late")).status).toBe("interrupted");
  expect(state.upsert("runtime", "thread", part("next", "next-turn")).status).toBe("running");
  expect(state.upsert("runtime", "thread", { ...part("late"), status: "completed" }).status).toBe(
    "completed",
  );
});

test("history contributes running items to settlement and cannot downgrade live output", () => {
  const state = new CodexImageGenerationState();
  const history = state.prepareHistory("runtime", "thread");
  expect(history(part("history")).status).toBe("running");
  expect(state.settle("runtime", "thread", "turn", "interrupted", timestamp)).toEqual([
    { ...part("history"), status: "interrupted" },
  ]);
  expect(history(part("history")).status).toBe("interrupted");
  expect(
    state.upsert("runtime", "thread", { ...part("history"), status: "completed" }).status,
  ).toBe("completed");
  expect(history(part("history")).status).toBe("completed");
});

test("history captured before runtime disposal cannot populate a replacement tracker", () => {
  const state = new CodexImageGenerationState();
  const history = state.prepareHistory("runtime", "thread");
  state.clearRuntime("runtime");
  expect(history(part("old")).status).toBe("incomplete");
  expect(state.upsert("runtime", "thread", part("old")).status).toBe("running");
});

test("the same image id in different turns remains independently scoped", () => {
  const state = new CodexImageGenerationState();
  state.upsert("runtime", "thread", part("same", "one"));
  state.upsert("runtime", "thread", part("same", "two"));
  state.settle("runtime", "thread", "one", "interrupted", timestamp);
  expect(state.upsert("runtime", "thread", part("same", "two")).status).toBe("running");
  expect(state.upsert("runtime", "thread", part("same", "one")).status).toBe("interrupted");
});

test("history pending at disposal retains an already confirmed interruption", () => {
  const state = new CodexImageGenerationState();
  const history = state.prepareHistory("runtime", "thread");
  state.settle("runtime", "thread", "turn", "interrupted", timestamp);
  state.clearRuntime("runtime");
  expect(history(part("old")).status).toBe("interrupted");
  expect(state.upsert("runtime", "thread", part("old")).status).toBe("running");
});

for (const reason of ["turn_ended", "runtime_failure"] as const) {
  test(`session-wide ${reason} survives a pending read with no known item or timestamp`, () => {
    const state = new CodexImageGenerationState();
    const history = state.prepareHistory("runtime", "thread");
    state.settle("runtime", "thread", undefined, reason, timestamp);
    expect(history(part("old"))).toMatchObject({ status: "incomplete", incompleteReason: reason });
    expect(history({ ...part("completed"), status: "completed" }).status).toBe("completed");
    expect(history({ ...part("failed"), status: "failed" }).status).toBe("failed");
    state.startTurn("runtime", "thread", "next");
    expect(history(part("next-image", "next")).status).toBe("running");
    state.settle("runtime", "thread", undefined, reason, timestamp);
    expect(history(part("next-image", "next")).status).toBe("incomplete");
    state.startTurn("runtime", "thread", "next");
    expect(history(part("late-image", "next")).status).toBe("incomplete");
  });
}

test("session-wide history context respects known time and exact owner", () => {
  const state = new CodexImageGenerationState();
  state.settle("runtime", "thread", undefined, "turn_ended", timestamp);
  const history = state.prepareHistory("runtime", "thread");
  expect(history(part("new"), "2026-09-06T10:00:01.000Z").status).toBe("running");
  expect(history(part("old"), "2026-09-06T09:59:59.000Z").status).toBe("incomplete");
  expect(state.prepareHistory("other-runtime", "thread")(part("other")).status).toBe("running");
  expect(state.prepareHistory("runtime", "other-thread")(part("other")).status).toBe("running");
});
