import { expect, test } from "bun:test";
import { codexWorkflowContext } from "./codex-workflow-context";

test("preserves a full Unicode workflow prompt within native fragment limits across revisions", () => {
  const prompt = "Rules α🙂漢\n".repeat(1500);
  const context = codexWorkflowContext(prompt);
  const ordered = Object.keys(context)
    .sort()
    .map((key) => context[key]!);
  expect(
    ordered.every(
      (entry) => entry.kind === "application" && Buffer.byteLength(entry.value, "utf8") <= 4000,
    ),
  ).toBe(true);
  expect(ordered.map((entry) => entry.value.slice(entry.value.indexOf("\n") + 1)).join("")).toBe(
    prompt,
  );
  const shorter = codexWorkflowContext("Updated task");
  expect(Object.keys(shorter).some((key) => key in context)).toBe(false);
  expect(Object.values(shorter)[0]?.value).toContain("part 1 of 1");
});
