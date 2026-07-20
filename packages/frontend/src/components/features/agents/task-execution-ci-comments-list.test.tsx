import { describe, expect, test } from "bun:test";
import type { PullRequestReviewComment } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { withAnimationFrameTestDriver } from "./agent-chat/test-support/animation-frame-test-driver";
import { TaskExecutionCiCommentsList } from "./task-execution-ci-comments-list";

const comment = (id: string, author = "reviewer"): PullRequestReviewComment => ({
  id,
  author,
  body: `Comment ${id}`,
  patch: null,
  suggestionPatches: [],
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
  test("preserves comment group nodes when refreshed counts change", async () => {
    await withAnimationFrameTestDriver(async () => {
      const view = render(<TaskExecutionCiCommentsList comments={[comment("one")]} />);
      const originalSection = screen.getByText("Needs review · 1").closest("section");

      view.rerender(<TaskExecutionCiCommentsList comments={[comment("one"), comment("two")]} />);

      expect(screen.getByText("Needs review · 2").closest("section")).toBe(originalSection);
    });
  });

  test("renders one comment per frame and restarts staging when the filter changes", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      render(
        <TaskExecutionCiCommentsList
          comments={[comment("human-one"), comment("bot", "review-bot[bot]"), comment("human-two")]}
        />,
      );

      expect(screen.queryByText("Comment human-one")).toBeNull();
      expect(screen.getByText("Rendering 0 of 3 comments…")).toBeTruthy();
      expect(frameDriver.pendingFrameCount()).toBe(1);

      await frameDriver.flushFrame();

      expect(screen.getByText("Comment human-one")).toBeTruthy();
      expect(screen.queryByText("Comment bot")).toBeNull();
      expect(frameDriver.pendingFrameCount()).toBe(1);

      fireEvent.click(screen.getByRole("button", { name: /Bots/ }));

      expect(screen.queryByText("Comment bot")).toBeNull();
      expect(screen.getByText("Rendering 0 of 1 comment…")).toBeTruthy();
      expect(frameDriver.pendingFrameCount()).toBe(1);

      await frameDriver.flushFrame();

      expect(screen.getByText("Comment bot")).toBeTruthy();
      expect(screen.queryByText(/Rendering \d+ of/)).toBeNull();
      expect(frameDriver.pendingFrameCount()).toBe(0);
    });
  });

  test("renders every comment and stops scheduling frames when staging completes", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      const comments = Array.from({ length: 40 }, (_, index) => comment(String(index)));
      render(<TaskExecutionCiCommentsList comments={comments} />);

      await frameDriver.flushFrames();

      for (const item of comments) {
        expect(screen.getByText(item.body)).toBeTruthy();
      }
      expect(screen.queryByText(/Rendering \d+ of/)).toBeNull();
      expect(frameDriver.pendingFrameCount()).toBe(0);
    });
  });

  test("cancels the next staged frame when the list unmounts", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      const view = render(
        <TaskExecutionCiCommentsList comments={[comment("one"), comment("two")]} />,
      );

      await frameDriver.flushFrame();
      expect(frameDriver.pendingFrameCount()).toBe(1);

      view.unmount();

      expect(frameDriver.pendingFrameCount()).toBe(0);
    });
  });
});
