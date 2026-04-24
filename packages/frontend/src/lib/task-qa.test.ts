import { describe, expect, test } from "bun:test";
import { createTaskCardFixture } from "@/test-utils/shared-test-fixtures";
import { isQaRejectedTask } from "./task-qa";

describe("isQaRejectedTask", () => {
  test("returns true for in-progress and blocked tasks with rejected qa verdicts", () => {
    expect(
      isQaRejectedTask(
        createTaskCardFixture({
          status: "in_progress",
          documentSummary: {
            spec: { has: false, updatedAt: undefined },
            plan: { has: false, updatedAt: undefined },
            qaReport: { has: true, updatedAt: "2026-03-10T10:00:00.000Z", verdict: "rejected" },
          },
        }),
      ),
    ).toBe(true);

    expect(
      isQaRejectedTask(
        createTaskCardFixture({
          status: "blocked",
          documentSummary: {
            spec: { has: false, updatedAt: undefined },
            plan: { has: false, updatedAt: undefined },
            qaReport: { has: true, updatedAt: "2026-03-10T10:00:00.000Z", verdict: "rejected" },
          },
        }),
      ),
    ).toBe(true);
  });

  test("returns false for missing tasks and non-rejected qa verdicts", () => {
    expect(isQaRejectedTask(null)).toBe(false);
    expect(
      isQaRejectedTask(
        createTaskCardFixture({
          status: "blocked",
          documentSummary: {
            spec: { has: false, updatedAt: undefined },
            plan: { has: false, updatedAt: undefined },
            qaReport: { has: true, updatedAt: "2026-03-10T10:00:00.000Z", verdict: "approved" },
          },
        }),
      ),
    ).toBe(false);
  });
});
