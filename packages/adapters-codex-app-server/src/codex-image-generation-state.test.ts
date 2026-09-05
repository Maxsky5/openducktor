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
  expect(state.settle("runtime", "thread", "turn", "interrupted")).toEqual([
    { ...part("one"), status: "interrupted" },
  ]);
  expect(state.upsert("runtime", "thread", part("one")).status).toBe("interrupted");
  expect(state.settle("runtime", "thread", undefined, "runtime_failure")).toEqual([
    { ...part("two", "other-turn"), status: "incomplete", incompleteReason: "runtime_failure" },
  ]);
  expect(state.settle("other-runtime", "thread", undefined, "turn_ended")).toHaveLength(1);
  expect(state.settle("runtime", "other-thread", undefined, "turn_ended")).toHaveLength(1);
});

test("late completion wins, duplicate IDs stay stable, and cleanup removes runtime state", () => {
  const state = new CodexImageGenerationState();
  state.upsert("runtime", "thread", part("one"));
  state.upsert("runtime", "thread", part("one"));
  state.upsert("runtime", "thread", part("two"));
  expect(state.settle("runtime", "thread", "turn", "turn_ended")).toHaveLength(2);
  expect(state.upsert("runtime", "thread", { ...part("one"), status: "completed" }).status).toBe(
    "completed",
  );
  expect(state.upsert("runtime", "thread", part("one")).status).toBe("completed");
  state.clearSession("thread", "runtime");
  expect(state.upsert("runtime", "thread", part("one")).status).toBe("running");
  state.clearRuntime("runtime");
  expect(state.settle("runtime", "thread", undefined, "runtime_failure")).toEqual([]);
});

test("a confirmed interruption replaces provisional idle settlement", () => {
  const state = new CodexImageGenerationState();
  state.upsert("runtime", "thread", part("one"));
  state.settle("runtime", "thread", "turn", "turn_ended");
  expect(state.settle("runtime", "thread", "turn", "interrupted")).toEqual([
    { ...part("one"), status: "interrupted" },
  ]);
});
