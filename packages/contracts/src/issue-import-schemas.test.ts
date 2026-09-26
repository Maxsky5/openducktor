import { describe, expect, test } from "bun:test";
import { issueItemsImportResultSchema } from "./issue-import-schemas";

describe("issue import result", () => {
  test("requires a Task ID for created items and a reason for failed items", () => {
    expect(
      issueItemsImportResultSchema.safeParse({ results: [{ sourceId: "1", outcome: "created" }] })
        .success,
    ).toBe(false);
    expect(
      issueItemsImportResultSchema.safeParse({ results: [{ sourceId: "1", outcome: "failed" }] })
        .success,
    ).toBe(false);
    expect(
      issueItemsImportResultSchema.safeParse({
        results: [{ sourceId: "1", outcome: "created", taskId: "TASK-1", reason: "Failed" }],
      }).success,
    ).toBe(false);
    expect(
      issueItemsImportResultSchema.safeParse({
        results: [{ sourceId: "1", outcome: "failed", reason: "Missing", taskId: "" }],
      }).success,
    ).toBe(false);
    expect(
      issueItemsImportResultSchema.safeParse({
        results: [
          { sourceId: "1", outcome: "created", taskId: "TASK-1" },
          { sourceId: "2", outcome: "failed", reason: "Already linked.", taskId: "TASK-2" },
        ],
      }).success,
    ).toBe(true);
  });
});
