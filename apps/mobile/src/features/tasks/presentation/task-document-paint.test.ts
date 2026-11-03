import {
  createSharedBoardWorkflows,
  createWorkflowTaskCardFixture,
} from "@openducktor/workflows/test-support";
import { describe, expect, test } from "bun:test";
import { taskReviewVerdicts, taskDescriptionForReading } from "./task-document-paint";

describe("taskDescriptionForReading", () => {
  test("hides a valid front matter block and keeps a malformed one", () => {
    expect(taskDescriptionForReading("---\nowner: ana\n---\nBody text")).toBe("Body text");
    expect(taskDescriptionForReading("---\nowner: ana\nBody text")).toBe(
      "---\nowner: ana\nBody text",
    );
    expect(taskDescriptionForReading("Plain body")).toBe("Plain body");
  });
});

describe("taskReviewVerdicts", () => {
  test("uses the declared review artifact and verdict instead of a built-in code", () => {
    const { alpha, board } = createSharedBoardWorkflows();
    const task = createWorkflowTaskCardFixture(alpha, board);
    expect(taskReviewVerdicts(task)[0]?.label).toBe("Not reviewed");
    task.artifactSummary.alpha_review = { present: true, verdict: "revise" };
    expect(taskReviewVerdicts(task)).toEqual([
      {
        id: "alpha_review",
        title: "alpha Review verdict",
        label: "alpha Review Revise",
        tone: "rejected",
      },
    ]);
    task.artifactSummary.alpha_review = { present: true, verdict: "accept" };
    expect(taskReviewVerdicts(task)[0]?.tone).toBe("success");
  });
});
