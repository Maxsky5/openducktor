import { describe, expect, test } from "bun:test";
import type { PullRequestReviewComment } from "@openducktor/contracts";
import { fireEvent, render, screen } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { withAnimationFrameTestDriver } from "@/test-utils/animation-frame-test-driver";
import { TaskExecutionCiCommentsList } from "./task-execution-ci-comments-list";

const comment = (id: string, author = "reviewer"): PullRequestReviewComment => ({
  id,
  author,
  authorAvatarUrl: null,
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

const createMemoryStorage = (): Storage => {
  const values = new Map<string, string>();
  return {
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => Array.from(values.keys())[index] ?? null,
    get length() {
      return values.size;
    },
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
};

const withLocalStorage = async (storage: Storage, run: () => Promise<void>): Promise<void> => {
  const originalStorage = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: storage });
  try {
    await run();
  } finally {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: originalStorage,
    });
  }
};

const commentsList = (comments: PullRequestReviewComment[]) => (
  <TooltipProvider>
    <TaskExecutionCiCommentsList comments={comments} />
  </TooltipProvider>
);

describe("TaskExecutionCiCommentsList", () => {
  test("skips stable comment inputs and renders changed comments", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      let authorReadCount = 0;
      const trackedComment: PullRequestReviewComment = {
        ...comment("one"),
        get author() {
          authorReadCount += 1;
          return "reviewer";
        },
      };
      const comments = [trackedComment];
      const view = render(commentsList(comments));
      await frameDriver.flushFrames();
      const initialAuthorReadCount = authorReadCount;

      view.rerender(commentsList(comments));

      expect(authorReadCount).toBe(initialAuthorReadCount);

      view.rerender(commentsList([{ ...comment("one"), body: "Updated review guidance." }]));
      await frameDriver.flushFrames();

      expect(screen.getByText("Updated review guidance.")).toBeTruthy();
    });
  });

  test("renders Humans and Bots newest first without status groups", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      render(
        commentsList([
          {
            ...comment("new-human", "new-human-author"),
            createdAt: "2026-07-12T10:00:00Z",
            isResolved: true,
          },
          {
            ...comment("old-human", "old-human-author"),
            createdAt: "2026-07-08T10:00:00Z",
          },
          {
            ...comment("middle-human", "middle-human-author"),
            createdAt: "2026-07-10T10:00:00Z",
            isResolved: null,
          },
          {
            ...comment("new-bot", "new-bot[bot]"),
            createdAt: "2026-07-11T10:00:00Z",
            isResolved: true,
          },
          {
            ...comment("old-bot", "old-bot[bot]"),
            createdAt: "2026-07-07T10:00:00Z",
          },
          {
            ...comment("middle-bot", "middle-bot[bot]"),
            createdAt: "2026-07-09T10:00:00Z",
            isResolved: null,
          },
        ]),
      );
      await frameDriver.flushFrames();

      fireEvent.click(screen.getByRole("button", { name: /Humans/ }));
      await frameDriver.flushMicrotasks();
      let renderedComments = screen.getAllByRole("article");

      expect(renderedComments[0]?.textContent).toContain("new-human-author");
      expect(renderedComments[1]?.textContent).toContain("middle-human-author");
      expect(renderedComments[2]?.textContent).toContain("old-human-author");
      expect(screen.queryByRole("heading", { name: /^Needs review/ })).toBeNull();
      expect(screen.queryByRole("heading", { name: /^Conversation/ })).toBeNull();
      expect(screen.queryByRole("heading", { name: /^Resolved/ })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: /Bots/ }));
      await frameDriver.flushMicrotasks();
      renderedComments = screen.getAllByRole("article");

      expect(renderedComments[0]?.textContent).toContain("new-bot[bot]");
      expect(renderedComments[1]?.textContent).toContain("middle-bot[bot]");
      expect(renderedComments[2]?.textContent).toContain("old-bot[bot]");
      expect(screen.queryByRole("heading", { name: /^Needs review/ })).toBeNull();
      expect(screen.queryByRole("heading", { name: /^Conversation/ })).toBeNull();
      expect(screen.queryByRole("heading", { name: /^Resolved/ })).toBeNull();
    });
  });

  test("renders All comments newest first without status groups", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      render(
        commentsList([
          { ...comment("oldest", "oldest-author"), createdAt: "2026-07-08T10:00:00Z" },
          {
            ...comment("newest", "newest-author"),
            createdAt: "2026-07-12T10:00:00Z",
            isResolved: true,
          },
          { ...comment("middle", "middle-author"), createdAt: "2026-07-10T10:00:00Z" },
        ]),
      );

      await frameDriver.flushFrames();

      const renderedComments = screen.getAllByRole("article");
      expect(renderedComments[0]?.textContent).toContain("newest-author");
      expect(renderedComments[1]?.textContent).toContain("middle-author");
      expect(renderedComments[2]?.textContent).toContain("oldest-author");
      expect(screen.queryByRole("heading", { name: /^Needs review/ })).toBeNull();
      expect(screen.queryByRole("heading", { name: /^Conversation/ })).toBeNull();
      expect(screen.queryByRole("heading", { name: /^Resolved/ })).toBeNull();
    });
  });

  test("renders every header immediately and stages comment bodies in bounded batches", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      const comments = Array.from({ length: 10 }, (_, index) => comment(String(index)));
      render(commentsList(comments));

      expect(screen.getAllByRole("article")).toHaveLength(10);
      expect(screen.queryByText("Comment 0")).toBeNull();
      expect(screen.queryByText(/Rendering \d+ of/) === null).toBe(true);
      expect(frameDriver.pendingFrameCount()).toBe(1);

      await frameDriver.flushFrame();

      expect(screen.getByText("Comment 0")).toBeTruthy();
      expect(screen.getByText("Comment 3")).toBeTruthy();
      expect(screen.queryByText("Comment 4")).toBeNull();
      expect(frameDriver.pendingFrameCount()).toBe(1);

      await frameDriver.flushFrames();

      expect(screen.getByText("Comment 9")).toBeTruthy();
      expect(frameDriver.pendingFrameCount()).toBe(0);
    });
  });

  test("renders every comment and stops scheduling frames when staging completes", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      const comments = Array.from({ length: 40 }, (_, index) => comment(String(index)));
      render(commentsList(comments));

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
        commentsList(Array.from({ length: 8 }, (_, index) => comment(String(index)))),
      );

      await frameDriver.flushFrame();
      expect(frameDriver.pendingFrameCount()).toBe(1);

      view.unmount();

      expect(frameDriver.pendingFrameCount()).toBe(0);
    });
  });

  test("keeps visible comment nodes mounted when hiding resolved comments", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      render(
        commentsList([
          comment("unresolved", "unresolved-author"),
          { ...comment("resolved", "resolved-author"), isResolved: true },
        ]),
      );
      await frameDriver.flushFrames();
      const retainedComment = screen.getByText("unresolved-author").closest("article");

      fireEvent.click(screen.getByRole("button", { name: "Filter comments" }));
      fireEvent.click(screen.getByRole("switch", { name: "Hide resolved" }));
      await frameDriver.flushMicrotasks();

      expect(screen.queryByText("resolved-author")).toBeNull();
      expect(screen.getByText("unresolved-author").closest("article") === retainedComment).toBe(
        true,
      );
      expect(frameDriver.pendingFrameCount()).toBe(0);
    });
  });

  test("keeps visible comment nodes mounted when changing comment tabs", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      render(commentsList([comment("human", "human-author"), comment("bot", "review-bot[bot]")]));
      await frameDriver.flushFrames();
      const retainedComment = screen.getByText("human-author").closest("article");

      fireEvent.click(screen.getByRole("button", { name: /Humans/ }));
      await frameDriver.flushMicrotasks();

      expect(screen.queryByText("review-bot[bot]")).toBeNull();
      expect(screen.getByText("human-author").closest("article") === retainedComment).toBe(true);
      expect(frameDriver.pendingFrameCount()).toBe(0);
    });
  });

  test("hides resolved comments and restores the persisted filter", async () => {
    const storage = createMemoryStorage();
    await withLocalStorage(storage, async () => {
      await withAnimationFrameTestDriver(async (frameDriver) => {
        const comments = [
          comment("unresolved", "unresolved-author"),
          { ...comment("resolved", "resolved-author"), isResolved: true },
        ];
        const view = render(commentsList(comments));
        await frameDriver.flushFrames();

        expect(screen.getByText("resolved-author")).toBeTruthy();
        const filterButton = screen.getByRole("button", { name: "Filter comments" });
        expect(filterButton.textContent).toBe("");
        expect(filterButton.classList.contains("bg-accent/60")).toBe(false);
        fireEvent.click(filterButton);
        const hideResolvedSwitch = screen.getByRole("switch", { name: "Hide resolved" });
        expect(hideResolvedSwitch.getAttribute("aria-checked")).toBe("false");

        fireEvent.click(hideResolvedSwitch);
        await frameDriver.flushMicrotasks();
        await frameDriver.flushFrames();

        expect(filterButton.classList.contains("bg-accent/60")).toBe(false);
        expect(screen.queryByText("resolved-author")).toBeNull();
        expect(screen.getByText("unresolved-author")).toBeTruthy();
        view.unmount();

        const restoredView = render(commentsList(comments));
        fireEvent.click(screen.getByRole("button", { name: "Filter comments" }));
        expect(
          screen.getByRole("switch", { name: "Hide resolved" }).getAttribute("aria-checked"),
        ).toBe("true");
        await frameDriver.flushFrames();
        expect(screen.queryByText("resolved-author")).toBeNull();
        expect(screen.getByText("unresolved-author")).toBeTruthy();

        restoredView.unmount();
        await frameDriver.flushMicrotasks();
      });
    });
  });
});
