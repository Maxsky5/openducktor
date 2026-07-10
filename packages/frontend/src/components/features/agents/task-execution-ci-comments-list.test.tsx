import { describe, expect, test } from "bun:test";
import type { PullRequestReviewComment } from "@openducktor/contracts";
import { render, screen } from "@testing-library/react";
import { TaskExecutionCiCommentsList } from "./task-execution-ci-comments-list";

const comment = (id: string): PullRequestReviewComment => ({
  id,
  author: "reviewer",
  body: `Comment ${id}`,
  patch: null,
  url: null,
  createdAt: "2026-07-10T10:00:00Z",
  updatedAt: null,
  path: "src/index.ts",
  line: 1,
  threadId: `thread-${id}`,
  isResolved: false,
  source: "review_thread",
});

describe("TaskExecutionCiCommentsList", () => {
  test("preserves comment group nodes when refreshed counts change", () => {
    const view = render(<TaskExecutionCiCommentsList comments={[comment("one")]} />);
    const originalSection = screen.getByText("Needs review · 1").closest("section");

    view.rerender(<TaskExecutionCiCommentsList comments={[comment("one"), comment("two")]} />);

    expect(screen.getByText("Needs review · 2").closest("section")).toBe(originalSection);
  });
});
