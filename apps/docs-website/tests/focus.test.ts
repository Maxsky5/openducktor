import { expect, test } from "bun:test";
import { sectionId } from "../lib/focus";

test("reads the section id of a hash, and no id from an empty or malformed hash", () => {
  expect(sectionId("#diagnostics")).toBe("diagnostics");
  expect(sectionId("#caf%C3%A9")).toBe("café");
  expect(sectionId("")).toBeNull();
  expect(sectionId("#")).toBeNull();
  expect(sectionId("#%")).toBeNull();
  expect(sectionId("#%E0%A4%A")).toBeNull();
});
