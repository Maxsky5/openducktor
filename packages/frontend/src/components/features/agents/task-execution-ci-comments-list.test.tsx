import { beforeEach, describe, expect, test } from "bun:test";
import type { PullRequestReviewActivity } from "@openducktor/contracts";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { withAnimationFrameTestDriver } from "@openducktor/frontend-core/test-support/animation-frame-test-driver";
import type { ClientConnection } from "@openducktor/frontend-core/connection/client-connection";
import { ClientConnectionProvider } from "@openducktor/frontend-core/connection/client-connection-react";
import {
  type ClientStorage,
  createMemoryClientStorage,
} from "@openducktor/frontend-core/platform/client-storage";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { TaskExecutionCiCommentsList } from "./task-execution-ci-comments-list";

const comment = (id: string, author = "reviewer"): PullRequestReviewActivity => ({
  id,
  author,
  authorAvatarUrl: null,
  body: `Comment ${id}`,
  patch: null,
  suggestionPatches: [],
  suggestionWarning: null,
  url: null,
  createdAt: "2026-07-10T10:00:00Z",
  updatedAt: null,
  path: "src/index.ts",
  line: 1,
  threadId: `thread-${id}`,
  isResolved: false,
  source: "review_thread",
});

// Each test starts with empty device storage. One connection serves each storage, so a rerender
// keeps the same connection.
let testStorage: ClientStorage = createMemoryClientStorage();
const connections = new WeakMap<ClientStorage, ClientConnection>();
const connectionFor = (storage: ClientStorage): ClientConnection => {
  let connection = connections.get(storage);
  if (!connection) {
    connection = createTestClientConnection({ storage });
    connections.set(storage, connection);
  }
  return connection;
};

beforeEach(() => {
  testStorage = createMemoryClientStorage();
});

const commentsList = (
  comments: PullRequestReviewActivity[],
  storage: ClientStorage = testStorage,
) => (
  <ClientConnectionProvider connection={connectionFor(storage)}>
    <TooltipProvider>
      <TaskExecutionCiCommentsList comments={comments} />
    </TooltipProvider>
  </ClientConnectionProvider>
);

describe("TaskExecutionCiCommentsList", () => {
  test("skips stable comment inputs and renders changed comments", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      let authorReadCount = 0;
      const trackedComment: PullRequestReviewActivity = {
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
      const view = render(
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
      const scoped = within(view.container);
      await frameDriver.flushFrames();

      fireEvent.click(scoped.getByRole("button", { name: /Humans/ }));
      await frameDriver.flushMicrotasks();
      let renderedComments = scoped.getAllByRole("article");

      expect(renderedComments[0]?.textContent).toContain("new-human-author");
      expect(renderedComments[1]?.textContent).toContain("middle-human-author");
      expect(renderedComments[2]?.textContent).toContain("old-human-author");
      expect(scoped.queryByRole("heading", { name: /^Needs review/ })).toBeNull();
      expect(scoped.queryByRole("heading", { name: /^Conversation/ })).toBeNull();
      expect(scoped.queryByRole("heading", { name: /^Resolved/ })).toBeNull();

      fireEvent.click(scoped.getByRole("button", { name: /Bots/ }));
      await frameDriver.flushMicrotasks();
      renderedComments = scoped.getAllByRole("article");

      expect(renderedComments[0]?.textContent).toContain("new-bot[bot]");
      expect(renderedComments[1]?.textContent).toContain("middle-bot[bot]");
      expect(renderedComments[2]?.textContent).toContain("old-bot[bot]");
      expect(scoped.queryByRole("heading", { name: /^Needs review/ })).toBeNull();
      expect(scoped.queryByRole("heading", { name: /^Conversation/ })).toBeNull();
      expect(scoped.queryByRole("heading", { name: /^Resolved/ })).toBeNull();
    });
  });

  test("renders All comments newest first without status groups", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      const view = render(
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
      const scoped = within(view.container);

      await frameDriver.flushFrames();

      const renderedComments = scoped.getAllByRole("article");
      expect(renderedComments[0]?.textContent).toContain("newest-author");
      expect(renderedComments[1]?.textContent).toContain("middle-author");
      expect(renderedComments[2]?.textContent).toContain("oldest-author");
      expect(scoped.queryByRole("heading", { name: /^Needs review/ })).toBeNull();
      expect(scoped.queryByRole("heading", { name: /^Conversation/ })).toBeNull();
      expect(scoped.queryByRole("heading", { name: /^Resolved/ })).toBeNull();
    });
  });

  test("renders every header immediately and stages comment bodies in bounded batches", async () => {
    await withAnimationFrameTestDriver(async (frameDriver) => {
      const comments = Array.from({ length: 10 }, (_, index) => comment(String(index)));
      const view = render(commentsList(comments));
      const scoped = within(view.container);

      expect(scoped.getAllByRole("article")).toHaveLength(10);
      expect(scoped.queryByText("Comment 0")).toBeNull();
      expect(scoped.queryByText(/Rendering \d+ of/) === null).toBe(true);
      expect(frameDriver.pendingFrameCount()).toBe(1);

      await frameDriver.flushFrame();

      expect(scoped.getByText("Comment 0")).toBeTruthy();
      expect(scoped.getByText("Comment 3")).toBeTruthy();
      expect(scoped.queryByText("Comment 4")).toBeNull();
      expect(frameDriver.pendingFrameCount()).toBe(1);

      await frameDriver.flushFrames();

      expect(scoped.getByText("Comment 9")).toBeTruthy();
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
    const storage = createMemoryClientStorage();
    await withAnimationFrameTestDriver(async (frameDriver) => {
      const comments = [
        comment("unresolved", "unresolved-author"),
        { ...comment("resolved", "resolved-author"), isResolved: true },
      ];
      const view = render(commentsList(comments, storage));
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

      const restoredView = render(commentsList(comments, storage));
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
