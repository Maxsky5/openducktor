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

test("later history refreshes an unchanged terminal image and clears its old file path", () => {
  const state = new CodexImageGenerationState();
  const first: AgentImageGenerationPart = {
    ...part("image"),
    status: "completed",
    output: { revision: "first" },
    savedPath: "/first.png",
  };
  state.prepareHistory("runtime", "thread")(first);
  const second = { ...first, output: { revision: "second" }, savedPath: "/second.png" };
  expect(state.prepareHistory("runtime", "thread")(second)).toEqual(second);
  const third: AgentImageGenerationPart = {
    ...part("image"),
    status: "completed",
    output: { revision: "third" },
  };
  expect(state.prepareHistory("runtime", "thread")(third)).toEqual(third);
});

test("history cannot replace an image updated after the read started", () => {
  const state = new CodexImageGenerationState();
  const first: AgentImageGenerationPart = {
    ...part("image"),
    status: "completed",
    output: { revision: "first" },
  };
  state.prepareHistory("runtime", "thread")(first);
  const pendingHistory = state.prepareHistory("runtime", "thread");
  const live = { ...first, output: { revision: "live" } };
  state.upsert("runtime", "thread", live);
  expect(pendingHistory({ ...first, savedPath: "/old.png" })).toEqual(live);
});

test("settlement only affects active images in the exact runtime, session, and turn", () => {
  const state = new CodexImageGenerationState();
  state.upsert("runtime", "thread", part("one"));
  state.upsert("runtime", "thread", part("two", "other-turn"));
  state.upsert("runtime", "thread", { ...part("done"), status: "completed" });
  state.upsert("other-runtime", "thread", part("one"));
  state.upsert("runtime", "other-thread", part("one"));
  expect(
    state.settle(
      "runtime",
      "thread",
      { scope: "turn", turnId: "turn", reason: "interrupted" },
      timestamp,
    ),
  ).toEqual([{ ...part("one"), status: "interrupted" }]);
  expect(state.upsert("runtime", "thread", part("one")).status).toBe("interrupted");
  expect(
    state.settle("runtime", "thread", { scope: "session", reason: "runtime_failure" }, timestamp),
  ).toEqual([
    { ...part("two", "other-turn"), status: "incomplete", incompleteReason: "runtime_failure" },
  ]);
  expect(
    state.settle("other-runtime", "thread", { scope: "session", reason: "turn_ended" }, timestamp),
  ).toHaveLength(1);
  expect(
    state.settle("runtime", "other-thread", { scope: "session", reason: "turn_ended" }, timestamp),
  ).toHaveLength(1);
});

test("late completion wins, duplicate IDs stay stable, and cleanup removes runtime state", () => {
  const state = new CodexImageGenerationState();
  state.upsert("runtime", "thread", part("one"));
  state.upsert("runtime", "thread", part("one"));
  state.upsert("runtime", "thread", part("two"));
  expect(
    state.settle(
      "runtime",
      "thread",
      { scope: "turn", turnId: "turn", reason: "turn_ended" },
      timestamp,
    ),
  ).toHaveLength(2);
  expect(state.upsert("runtime", "thread", { ...part("one"), status: "completed" }).status).toBe(
    "completed",
  );
  expect(state.upsert("runtime", "thread", part("one")).status).toBe("completed");
  state.clearSession("thread", "runtime");
  expect(state.upsert("runtime", "thread", part("one")).status).toBe("running");
  state.clearRuntime("runtime");
  expect(
    state.settle("runtime", "thread", { scope: "session", reason: "runtime_failure" }, timestamp),
  ).toEqual([]);
});

test("a confirmed interruption replaces provisional idle settlement", () => {
  const state = new CodexImageGenerationState();
  state.upsert("runtime", "thread", part("one"));
  state.settle(
    "runtime",
    "thread",
    { scope: "turn", turnId: "turn", reason: "turn_ended" },
    timestamp,
  );
  expect(
    state.settle(
      "runtime",
      "thread",
      { scope: "turn", turnId: "turn", reason: "interrupted" },
      timestamp,
    ),
  ).toEqual([{ ...part("one"), status: "interrupted" }]);
});

test("a terminal turn protects a delayed first start while allowing the next turn", () => {
  const state = new CodexImageGenerationState();
  state.settle(
    "runtime",
    "thread",
    { scope: "turn", turnId: "turn", reason: "interrupted" },
    timestamp,
  );
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
  expect(
    state.settle(
      "runtime",
      "thread",
      { scope: "turn", turnId: "turn", reason: "interrupted" },
      timestamp,
    ),
  ).toEqual([{ ...part("history"), status: "interrupted" }]);
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
  state.settle(
    "runtime",
    "thread",
    { scope: "turn", turnId: "one", reason: "interrupted" },
    timestamp,
  );
  expect(state.upsert("runtime", "thread", part("same", "two")).status).toBe("running");
  expect(state.upsert("runtime", "thread", part("same", "one")).status).toBe("interrupted");
});

test("history pending at disposal retains an already confirmed interruption", () => {
  const state = new CodexImageGenerationState();
  const history = state.prepareHistory("runtime", "thread");
  state.settle(
    "runtime",
    "thread",
    { scope: "turn", turnId: "turn", reason: "interrupted" },
    timestamp,
  );
  state.clearRuntime("runtime");
  expect(history(part("old")).status).toBe("interrupted");
  expect(state.upsert("runtime", "thread", part("old")).status).toBe("running");
});

for (const reason of ["turn_ended", "runtime_failure"] as const) {
  test(`session-wide ${reason} survives a pending read with no known item or timestamp`, () => {
    const state = new CodexImageGenerationState();
    const history = state.prepareHistory("runtime", "thread");
    state.settle("runtime", "thread", { scope: "session", reason: reason }, timestamp);
    expect(history(part("old"))).toMatchObject({ status: "incomplete", incompleteReason: reason });
    expect(history({ ...part("completed"), status: "completed" }).status).toBe("completed");
    expect(history({ ...part("failed"), status: "failed" }).status).toBe("failed");
    state.startTurn("runtime", "thread", "next");
    expect(history(part("next-image", "next")).status).toBe("running");
    state.settle("runtime", "thread", { scope: "session", reason: reason }, timestamp);
    expect(history(part("next-image", "next")).status).toBe("incomplete");
    state.startTurn("runtime", "thread", "next");
    expect(history(part("late-image", "next")).status).toBe("incomplete");
  });
}

test("session-wide history context respects known time and exact owner", () => {
  const state = new CodexImageGenerationState();
  state.settle("runtime", "thread", { scope: "session", reason: "turn_ended" }, timestamp);
  const history = state.prepareHistory("runtime", "thread");
  expect(history(part("new"), "2026-09-06T10:00:01.000Z").status).toBe("running");
  expect(history(part("old"), "2026-09-06T09:59:59.000Z").status).toBe("incomplete");
  expect(state.prepareHistory("other-runtime", "thread")(part("other")).status).toBe("running");
  expect(state.prepareHistory("runtime", "other-thread")(part("other")).status).toBe("running");
});

test("native session cutoffs reject older starts and duplicate ends before changing history", () => {
  const state = new CodexImageGenerationState();
  const start = "2026-09-06T10:00:02.000Z";
  const end = "2026-09-06T10:00:03.000Z";
  state.startTurn("runtime", "thread", "turn", start);
  state.upsert("runtime", "thread", part("image"), start);
  expect(
    state.settle(
      "runtime",
      "thread",
      {
        scope: "session",
        reason: "turn_ended",
        timestamp,
      },
      timestamp,
    ),
  ).toBeNull();
  expect(state.prepareHistory("runtime", "thread")(part("image"), start).status).toBe("running");
  expect(
    state.settle(
      "runtime",
      "thread",
      {
        scope: "session",
        reason: "turn_ended",
        timestamp: end,
      },
      end,
    ),
  ).toHaveLength(1);
  for (const cutoff of [timestamp, end]) {
    expect(
      state.settle(
        "runtime",
        "thread",
        {
          scope: "session",
          reason: "turn_ended",
          timestamp: cutoff,
        },
        cutoff,
      ),
    ).toBeNull();
  }
  expect(state.prepareHistory("runtime", "thread")(part("late", "unknown"), start).status).toBe(
    "incomplete",
  );
});

test("a first live image protects its turn without a turn-start notification", () => {
  const state = new CodexImageGenerationState();
  state.upsert("runtime", "thread", part("image"), "2026-09-06T10:00:01.000Z");
  expect(
    state.settle(
      "runtime",
      "thread",
      {
        scope: "session",
        reason: "turn_ended",
        timestamp,
      },
      timestamp,
    ),
  ).toBeNull();
  expect(state.upsert("runtime", "thread", part("image")).status).toBe("running");
  // Explicit control must still clean up when the local clock equals an earlier cutoff.
  expect(
    state.settle("runtime", "thread", { scope: "session", reason: "turn_ended" }, timestamp),
  ).toHaveLength(1);
});
