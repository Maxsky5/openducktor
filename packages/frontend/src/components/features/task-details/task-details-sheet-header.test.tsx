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

  test("renders a detect PR button for active review statuses", () => {
    const task = createTaskCardFixture({
      id: "TASK-3",
      status: "human_review",
    });

    const html = renderToStaticMarkup(
      createElement(TaskDetailsSheetHeader, {
        task,
        subtasksCount: 0,
        taskLabels: [],
        onDetectPullRequest: () => {},
      }),
    );

    expect(html).toContain("Detect PR");
    expect(html).toContain("task-details-detect-pr-button");
  });

  test("renders unlink PR and hides detect PR when a pull request is already linked", () => {
    const task = createTaskCardFixture({
      id: "TASK-3",
      status: "human_review",
      pullRequest: {
        providerId: "github",
        number: 17,
        url: "https://github.com/openai/openducktor/pull/17",
        state: "open",
        createdAt: "2026-03-12T12:24:09Z",
        updatedAt: "2026-03-12T12:24:09Z",
        lastSyncedAt: undefined,
        mergedAt: undefined,
        closedAt: undefined,
      },
    });

    const html = renderToStaticMarkup(
      createElement(TaskDetailsSheetHeader, {
        task,
        subtasksCount: 0,
        taskLabels: [],
        onDetectPullRequest: () => {},
        onUnlinkPullRequest: () => {},
      }),
    );

    expect(html).toContain("PR #17");
    expect(html).toContain("Unlink PR");
    expect(html).toContain("task-details-unlink-pr-button");
    expect(html).not.toContain("task-details-detect-pr-button");
  });

  test("renders the unlinking state when PR unlink is in flight", () => {
    const task = createTaskCardFixture({
      id: "TASK-6",
      status: "human_review",
      pullRequest: {
        providerId: "github",
        number: 27,
        url: "https://github.com/openai/openducktor/pull/27",
        state: "open",
        createdAt: "2026-03-12T12:24:09Z",
        updatedAt: "2026-03-12T12:24:09Z",
        lastSyncedAt: undefined,
        mergedAt: undefined,
        closedAt: undefined,
      },
    });

    const html = renderToStaticMarkup(
      createElement(TaskDetailsSheetHeader, {
        task,
        subtasksCount: 0,
        taskLabels: [],
        onUnlinkPullRequest: () => {},
        isUnlinkingPullRequest: true,
      }),
    );

    expect(html).toContain("Unlinking PR");
    expect(html).toContain("disabled");
  });

  test("omits unlink PR for statuses that cannot manage pull requests", () => {
    const task = createTaskCardFixture({
      id: "TASK-5",
      status: "closed",
      pullRequest: {
        providerId: "github",
        number: 21,
        url: "https://github.com/openai/openducktor/pull/21",
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
        onUnlinkPullRequest: () => {},
      }),
    );

    expect(html).not.toContain("task-details-unlink-pr-button");
  });

  test("renders the detecting state when PR detection is in flight", () => {
    const task = createTaskCardFixture({
      id: "TASK-3",
      status: "human_review",
    });

    const html = renderToStaticMarkup(
      createElement(TaskDetailsSheetHeader, {
        task,
        subtasksCount: 0,
        taskLabels: [],
        onDetectPullRequest: () => {},
        isDetectingPullRequest: true,
      }),
    );

    expect(html).toContain("Detecting PR");
    expect(html).toContain("disabled");
  });

  test("omits the detect PR button for non-build statuses", () => {
    const task = createTaskCardFixture({
      id: "TASK-4",
      status: "open",
    });

    const html = renderToStaticMarkup(
      createElement(TaskDetailsSheetHeader, {
        task,
        subtasksCount: 0,
        taskLabels: [],
        onDetectPullRequest: () => {},
      }),
    );

    expect(html).not.toContain("Detect PR");
    expect(html).not.toContain("task-details-detect-pr-button");
  });

  test("renders title attribute on truncated title span for hover tooltip", () => {
    const longTitle =
      "This is a very long task title that exceeds available width and should truncate";
    const task = createTaskCardFixture({
      id: "TASK-7",
      title: longTitle,
    });

    const html = renderToStaticMarkup(
      createElement(TaskDetailsSheetHeader, {
        task,
        subtasksCount: 0,
        taskLabels: [],
      }),
    );

    expect(html).toContain(`title="${longTitle}"`);
  });

  test("renders task labels with the shared chip style and tag icon", () => {
    const task = createTaskCardFixture({ id: "TASK-8" });

    const html = renderToStaticMarkup(
      createElement(TaskDetailsSheetHeader, {
        task,
        subtasksCount: 0,
        taskLabels: ["frontend", "ux"],
      }),
    );

    expect(html).toContain("frontend");
    expect(html).toContain("ux");
    expect(html).toContain("lucide-tag");
    expect(html).toContain("rounded-full");
  });
});
