import { expect, test } from "bun:test";
import type { AgentImageGenerationPart } from "@openducktor/contracts";
import { mergeAgentImageGeneration, settleAgentImageGeneration } from "./agent-image-generation";

const part = (status: AgentImageGenerationPart["status"]): AgentImageGenerationPart => ({
  kind: "image_generation",
  messageId: "image",
  partId: "image",
  itemId: "image",
  turnId: "turn",
  status,
});

test("runtime failure replaces provisional idle without replacing confirmed outcomes", () => {
  const idle = settleAgentImageGeneration(part("running"), "turn_ended");
  const failed = settleAgentImageGeneration(idle, "runtime_failure");
  expect(failed).toMatchObject({ status: "incomplete", incompleteReason: "runtime_failure" });
  expect(settleAgentImageGeneration(failed, "turn_ended")).toBe(failed);
  expect(settleAgentImageGeneration(failed, "runtime_failure")).toBe(failed);
  for (const status of ["completed", "failed", "interrupted"] as const) {
    const confirmed = part(status);
    expect(settleAgentImageGeneration(confirmed, "runtime_failure")).toBe(confirmed);
  }
});

test("old starts and incomplete history cannot downgrade native completion", () => {
  const completed = {
    ...part("completed"),
    output: { revision: "output-v1" },
  };
  expect(mergeAgentImageGeneration(completed, part("running"), "live")).toEqual(completed);
  expect(mergeAgentImageGeneration(completed, part("incomplete"), "history")).toEqual(completed);
});

test("late native completion replaces an unconfirmed or interrupted outcome", () => {
  for (const status of ["incomplete", "interrupted"] as const) {
    expect(mergeAgentImageGeneration(part(status), part("completed"), "live").status).toBe(
      "completed",
    );
  }
});

test("history fills absent metadata while preserving newer live output", () => {
  const live = {
    ...part("completed"),
    savedPath: "/new.png",
    output: { revision: "output-v2" },
  };
  const old = { ...part("completed"), revisedPrompt: "A duck", savedPath: "/old.png" };
  expect(mergeAgentImageGeneration(live, old, "history")).toEqual({
    ...live,
    revisedPrompt: "A duck",
  });
  expect(mergeAgentImageGeneration(live, part("failed"), "history")).toEqual(live);
});

test("different native items and turns cannot merge", () => {
  expect(() =>
    mergeAgentImageGeneration(part("running"), { ...part("completed"), itemId: "other" }, "live"),
  ).toThrow("identity");
  expect(() =>
    mergeAgentImageGeneration(part("running"), { ...part("completed"), turnId: "other" }, "live"),
  ).toThrow("identity");
});

test("confirmed interruption cannot be replaced by unconfirmed history", () => {
  expect(mergeAgentImageGeneration(part("interrupted"), part("incomplete"), "history")).toEqual(
    part("interrupted"),
  );
});

test("history cannot attach a file from an older output revision", () => {
  const live = {
    ...part("completed"),
    output: { revision: "output-v1" },
  };
  const old = {
    ...part("completed"),
    savedPath: "/old.png",
    output: { revision: "output-v2" },
  };
  expect(mergeAgentImageGeneration(live, old, "history")).toEqual(live);
});

test("a new live output revision replaces stale file metadata", () => {
  const old = {
    ...part("completed"),
    revisedPrompt: "A duck",
    savedPath: "/old.png",
    output: { revision: "first" },
  };
  const next = { ...part("completed"), output: { revision: "second" } };
  expect(mergeAgentImageGeneration(old, next, "live")).toEqual({
    ...next,
    revisedPrompt: "A duck",
  });
  expect(mergeAgentImageGeneration(old, { ...next, savedPath: "/new.png" }, "live").savedPath).toBe(
    "/new.png",
  );
});

test("matching revisions can fill file metadata without replacing the output", () => {
  const current = { ...part("completed"), output: { revision: "same" } };
  const withPath = { ...current, savedPath: "/image.png" };
  expect(mergeAgentImageGeneration(current, withPath, "history")).toEqual(withPath);
  expect(mergeAgentImageGeneration(withPath, current, "live")).toEqual(withPath);
});

test("fresh history replaces the output captured before the read", () => {
  const previous = {
    ...part("completed"),
    savedPath: "/old.png",
    output: { revision: "old" },
  };
  const refreshed = { ...part("completed"), output: { revision: "new" } };
  expect(mergeAgentImageGeneration(previous, refreshed, "history", previous)).toEqual(refreshed);
  expect(
    mergeAgentImageGeneration(
      previous,
      { ...refreshed, savedPath: "/new.png" },
      "history",
      previous,
    ),
  ).toEqual({ ...refreshed, savedPath: "/new.png" });
});

test("a live completion during the history read keeps its own output revision", () => {
  const beforeRead = part("running");
  const live = { ...part("completed"), output: { revision: "live" } };
  const history = {
    ...part("completed"),
    output: { revision: "history" },
    savedPath: "/history.png",
  };
  expect(mergeAgentImageGeneration(live, history, "history", beforeRead)).toEqual(live);
});

test("completion replay without media preserves the known output and metadata", () => {
  const completed: AgentImageGenerationPart = {
    ...part("completed"),
    revisedPrompt: "A duck",
    transparentBackground: false,
    output: { revision: "output-v1" },
  };
  expect(mergeAgentImageGeneration(completed, part("completed"), "live")).toEqual(completed);
});

test("a later terminal outcome retains prompt metadata but clears prior lifecycle fields", () => {
  const current: AgentImageGenerationPart = {
    ...part("incomplete"),
    revisedPrompt: "A duck",
    incompleteReason: "turn_ended",
  };
  expect(mergeAgentImageGeneration(current, part("completed"), "live")).toEqual({
    ...part("completed"),
    revisedPrompt: "A duck",
  });
});

test("fresh history can remove an unavailable preview and later restore its content revision", () => {
  const available = { ...part("completed"), output: { revision: "first" } };
  const missing = { ...part("completed"), previewUnavailableReason: "Saved file is missing" };
  const removed = mergeAgentImageGeneration(available, missing, "history", available);
  expect(removed).toEqual(missing);
  const restored = mergeAgentImageGeneration(
    removed,
    { ...available, output: { revision: "second" } },
    "history",
    removed,
  );
  expect(restored.output?.revision).toBe("second");
  expect(restored.previewUnavailableReason).toBeUndefined();
});

test("late history cannot replace a newer live preview failure or restored output", () => {
  const old = part("running");
  const missing = { ...part("completed"), previewUnavailableReason: "Saved file is missing" };
  const available = { ...part("completed"), output: { revision: "current" } };
  expect(mergeAgentImageGeneration(missing, available, "history", old)).toEqual(missing);
  expect(mergeAgentImageGeneration(available, missing, "history", old)).toEqual(available);
});
