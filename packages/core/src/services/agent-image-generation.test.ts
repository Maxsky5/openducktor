import { expect, test } from "bun:test";
import type { AgentImageGenerationPart } from "@openducktor/contracts";
import { mergeAgentImageGeneration } from "./agent-image-generation";

const part = (status: AgentImageGenerationPart["status"]): AgentImageGenerationPart => ({
  kind: "image_generation",
  messageId: "image",
  partId: "image",
  itemId: "image",
  turnId: "turn",
  status,
});

test("old starts and incomplete history cannot downgrade native completion", () => {
  const completed = {
    ...part("completed"),
    output: { itemId: "image", representation: "inline" as const },
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
    output: { itemId: "image", representation: "saved_file" as const },
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

test("history cannot attach a different saved-file source to a newer inline result", () => {
  const live = {
    ...part("completed"),
    output: { itemId: "image", representation: "inline" as const },
  };
  const old = {
    ...part("completed"),
    savedPath: "/old.png",
    output: { itemId: "image", representation: "saved_file" as const },
  };
  expect(mergeAgentImageGeneration(live, old, "history")).toEqual(live);
});

test("completion replay without media preserves the known output and metadata", () => {
  const completed: AgentImageGenerationPart = {
    ...part("completed"),
    revisedPrompt: "A duck",
    transparentBackground: false,
    output: { itemId: "image", representation: "inline" },
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
