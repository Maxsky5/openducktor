import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createTaskCardFixture } from "@/pages/agents/agent-studio-test-utils";
import { TaskDetailsSheetHeader } from "./task-details-sheet-header";

describe("TaskDetailsSheetHeader", () => {
  test("renders qa rejected badge for qa-rework tasks", () => {
    const task = createTaskCardFixture({
      id: "TASK-1",
      title: "Fix OAuth flow",
      status: "in_progress",
      documentSummary: {
        spec: { has: false, updatedAt: undefined },
        plan: { has: false, updatedAt: undefined },
        qaReport: { has: true, updatedAt: "2026-02-22T10:00:00.000Z", verdict: "rejected" },
      },
    });

    const html = renderToStaticMarkup(
      createElement(TaskDetailsSheetHeader, {
        task,
        subtasksCount: 0,
        taskLabels: [],
      }),
    );

    expect(html).toContain("QA Rejected");
  });

  test("renders pull request tag alongside the other header badges", () => {
    const task = createTaskCardFixture({
      id: "TASK-2",
      pullRequest: {
        providerId: "github",
        number: 110,
        url: "https://github.com/openai/openducktor/pull/110",
        state: "merged",
        createdAt: "2026-03-12T12:24:09Z",
        updatedAt: "2026-03-12T12:24:09Z",
        lastSyncedAt: undefined,
        mergedAt: "2026-03-12T12:30:00Z",
        closedAt: undefined,
      },
    });

    const html = renderToStaticMarkup(
      createElement(TaskDetailsSheetHeader, {
        task,
        subtasksCount: 0,
        taskLabels: [],
      }),
    );

    expect(html).toContain("PR #110");
    expect(html).toContain("text-violet");
  });
});
