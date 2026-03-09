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
});
