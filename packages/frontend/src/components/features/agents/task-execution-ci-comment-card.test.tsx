import { expect, spyOn, test } from "bun:test";
import type { PullRequestReviewActivity, PullRequestReviewOutcome } from "@openducktor/contracts";
import { fireEvent, render } from "@testing-library/react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as externalUrl from "@/lib/open-external-url";
import { QueryProvider } from "@/lib/query-provider";
import {
  TaskExecutionCiCommentCard,
  TaskExecutionCiMarkdownLink,
} from "./task-execution-ci-comment-card";

const createComment = (): PullRequestReviewActivity => ({
  id: "comment-1",
  author: "reviewer",
  authorAvatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
  body: "Please update this.",
  patch: null,
  suggestionPatches: [],
  url: "https://github.com/openai/openducktor/pull/733#discussion_r1",
  createdAt: "2026-07-12T08:00:00Z",
  updatedAt: null,
  path: "src/index.ts",
  line: 1,
  threadId: "thread-1",
  isResolved: false,
  source: "review_thread",
});

const review = (reviewOutcome: PullRequestReviewOutcome, body = ""): PullRequestReviewActivity => ({
  ...createComment(),
  id: `review-${reviewOutcome}`,
  body,
  path: null,
  line: null,
  threadId: null,
  isResolved: null,
  source: "review",
  reviewOutcome,
});

test.each([
  ["approved", "Approved"],
  ["changes_requested", "Changes requested"],
  ["commented", "Commented"],
  ["dismissed", "Review dismissed"],
] as const)("renders the %s review outcome without an empty-body placeholder", (outcome, label) => {
  const view = render(
    <TooltipProvider>
      <TaskExecutionCiCommentCard comment={review(outcome)} isBot={false} />
    </TooltipProvider>,
  );

  expect(view.getByText(label)).toBeTruthy();
  expect(view.queryByText("No comment body.")).toBeNull();
});

test("renders a review outcome before deferred body work and shows its body once ready", () => {
  const reviewWithBody = review("approved", "This is ready to merge.");
  const view = render(
    <TooltipProvider>
      <TaskExecutionCiCommentCard comment={reviewWithBody} isBot={false} isBodyReady={false} />
    </TooltipProvider>,
  );

  expect(view.getByText("Approved")).toBeTruthy();
  expect(view.queryByText(reviewWithBody.body)).toBeNull();

  view.rerender(
    <TooltipProvider>
      <TaskExecutionCiCommentCard comment={reviewWithBody} isBot={false} isBodyReady />
    </TooltipProvider>,
  );

  expect(view.getAllByText("Approved")).toHaveLength(1);
  expect(view.getAllByText(reviewWithBody.body)).toHaveLength(1);
});

test("uses review-specific accessible action names and external link text", () => {
  const view = render(
    <TooltipProvider>
      <TaskExecutionCiCommentCard comment={review("commented")} isBot={false} />
    </TooltipProvider>,
  );

  expect(view.getByRole("button", { name: "Collapse review from reviewer" })).toBeTruthy();
  expect(view.getByRole("button", { name: "Open review from reviewer" })).toBeTruthy();
});

test.each(["light", "dark"] as const)("renders review outcome text in the %s theme", (theme) => {
  const view = render(
    <QueryProvider useIsolatedClient>
      <ThemeProvider defaultTheme={theme}>
        <TooltipProvider>
          <TaskExecutionCiCommentCard comment={review("dismissed")} isBot={false} />
        </TooltipProvider>
      </ThemeProvider>
    </QueryProvider>,
  );

  expect(view.getByText("Review dismissed")).toBeTruthy();
});

test("opens review comments through the external URL shell bridge", () => {
  const openExternalUrlSpy = spyOn(externalUrl, "openExternalUrl").mockResolvedValue();
  const comment = createComment();

  try {
    const view = render(
      <TooltipProvider>
        <TaskExecutionCiCommentCard comment={comment} isBot={false} />
      </TooltipProvider>,
    );

    fireEvent.click(view.getByRole("button", { name: "Open comment from reviewer" }));

    expect(openExternalUrlSpy).toHaveBeenCalledWith(comment.url);
  } finally {
    openExternalUrlSpy.mockRestore();
  }
});

test("skips unchanged card inputs and renders updated comments", () => {
  let bodyReadCount = 0;
  const trackedComment: PullRequestReviewActivity = {
    ...createComment(),
    get body() {
      bodyReadCount += 1;
      return "Please update this.";
    },
  };
  const card = (cardComment: PullRequestReviewActivity) => (
    <TooltipProvider>
      <TaskExecutionCiCommentCard comment={cardComment} isBot={false} />
    </TooltipProvider>
  );
  const view = render(card(trackedComment));
  const initialBodyReadCount = bodyReadCount;

  view.rerender(card(trackedComment));

  expect(bodyReadCount).toBe(initialBodyReadCount);

  view.rerender(card({ ...createComment(), body: "Updated review guidance." }));

  expect(view.getByText("Updated review guidance.")).toBeTruthy();
});

test("opens links in review markdown through the external URL shell bridge", () => {
  const openExternalUrlSpy = spyOn(externalUrl, "openExternalUrl").mockResolvedValue();
  const markdownUrl = "https://example.com/review-guidance";

  try {
    const view = render(
      <TaskExecutionCiMarkdownLink href={markdownUrl}>Review guidance</TaskExecutionCiMarkdownLink>,
    );
    const link = view.getByRole("link", { name: "Review guidance" });

    expect(link.getAttribute("target")).toBeNull();
    fireEvent.click(link);

    expect(openExternalUrlSpy).toHaveBeenCalledWith(markdownUrl);
  } finally {
    openExternalUrlSpy.mockRestore();
  }
});

test("labels suggested changes as a distinct review section", () => {
  const view = render(
    <QueryProvider useIsolatedClient>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <TaskExecutionCiCommentCard
            comment={{
              ...createComment(),
              body: "Use the shared loading state.",
              suggestionPatches: [
                "@@ -8,1 +8,1 @@\n-disabled={isGoogleLoading}\n+disabled={isAnyLoading}",
              ],
            }}
            isBot={true}
          />
        </TooltipProvider>
      </ThemeProvider>
    </QueryProvider>,
  );

  expect(view.getByRole("heading", { name: "Suggested change" })).toBeTruthy();
  expect(view.getByLabelText("Suggested change")).toBeTruthy();
});

test("collapses resolved comments by default and toggles comment bodies", () => {
  const resolvedComment = {
    ...createComment(),
    body: "Resolved review guidance.",
    isResolved: true,
  };
  const resolvedView = render(
    <TooltipProvider>
      <TaskExecutionCiCommentCard comment={resolvedComment} isBot={false} />
    </TooltipProvider>,
  );

  expect(resolvedView.queryByText(resolvedComment.body)).toBeNull();

  fireEvent.click(resolvedView.getByRole("button", { name: "Expand comment from reviewer" }));

  expect(resolvedView.getByText(resolvedComment.body)).toBeTruthy();

  fireEvent.click(resolvedView.getByRole("button", { name: "Collapse comment from reviewer" }));

  expect(resolvedView.queryByText(resolvedComment.body)).toBeNull();
  resolvedView.unmount();

  const unresolvedComment = createComment();
  const unresolvedView = render(
    <TooltipProvider>
      <TaskExecutionCiCommentCard comment={unresolvedComment} isBot={false} />
    </TooltipProvider>,
  );

  expect(unresolvedView.getByText(unresolvedComment.body)).toBeTruthy();
});

test("resets the disclosure default when the thread resolution changes", () => {
  const comment = createComment();
  const card = (isResolved: boolean) => (
    <TooltipProvider>
      <TaskExecutionCiCommentCard comment={{ ...comment, isResolved }} isBot={false} />
    </TooltipProvider>
  );
  const view = render(card(true));

  expect(view.queryByText(comment.body)).toBeNull();

  view.rerender(card(false));

  expect(view.getByText(comment.body)).toBeTruthy();

  view.rerender(card(true));

  expect(view.queryByText(comment.body)).toBeNull();
});

test("renders a deferred body immediately when the user expands the comment", () => {
  const deferredComment = {
    ...createComment(),
    body: "Deferred review guidance.",
  };
  const view = render(
    <TooltipProvider>
      <TaskExecutionCiCommentCard comment={deferredComment} isBot={false} isBodyReady={false} />
    </TooltipProvider>,
  );

  expect(view.queryByText(deferredComment.body)).toBeNull();

  fireEvent.click(view.getByRole("button", { name: "Collapse comment from reviewer" }));

  fireEvent.click(view.getByRole("button", { name: "Expand comment from reviewer" }));

  expect(view.getByText(deferredComment.body)).toBeTruthy();
});

test("shows the comment header as clickable and vertically centers its actions", () => {
  const comment = createComment();
  const view = render(
    <TooltipProvider>
      <TaskExecutionCiCommentCard comment={comment} isBot={false} />
    </TooltipProvider>,
  );
  const collapseButton = view.getByRole("button", { name: "Collapse comment from reviewer" });
  const externalButton = view.getByRole("button", { name: "Open comment from reviewer" });

  expect(collapseButton.classList.contains("cursor-pointer")).toBe(true);
  expect(collapseButton.classList.contains("items-center")).toBe(true);
  expect(collapseButton.classList.contains("items-start")).toBe(false);
  expect(externalButton.parentElement?.classList.contains("items-center")).toBe(true);
  expect(externalButton.parentElement?.classList.contains("pt-2")).toBe(false);
});

test("shows either a lazy author avatar or its fallback", () => {
  const comment = createComment();
  const view = render(
    <TooltipProvider>
      <TaskExecutionCiCommentCard comment={comment} isBot={false} />
    </TooltipProvider>,
  );

  const avatar = view.getByAltText("reviewer avatar") as HTMLImageElement;

  expect(avatar.src).toBe("https://avatars.githubusercontent.com/u/1?v=4");
  expect(avatar.loading).toBe("lazy");
  expect(avatar.decoding).toBe("async");
  expect(view.queryByTestId("ci-comment-avatar-fallback")).toBeNull();

  fireEvent.error(avatar);

  expect(view.queryByAltText("reviewer avatar")).toBeNull();
  expect(view.getByTestId("ci-comment-avatar-fallback")).toBeTruthy();

  view.unmount();
  const fallbackView = render(
    <TooltipProvider>
      <TaskExecutionCiCommentCard comment={{ ...comment, authorAvatarUrl: null }} isBot={false} />
    </TooltipProvider>,
  );

  expect(fallbackView.queryByAltText("reviewer avatar")).toBeNull();
  expect(fallbackView.getByTestId("ci-comment-avatar-fallback")).toBeTruthy();
});

test("keeps the filename visible when a comment path is truncated", () => {
  const longPath = "apps/web/src/components/LandingPage.tsx";
  const view = render(
    <TooltipProvider>
      <TaskExecutionCiCommentCard
        comment={{ ...createComment(), path: longPath, line: 16 }}
        isBot={false}
      />
    </TooltipProvider>,
  );

  const status = view.getByText("Unresolved");
  const location = view.getByTitle(`${longPath}:16`);

  expect(status.parentElement === location.parentElement).toBe(true);
  expect(location.getAttribute("dir")).toBe("rtl");
  expect(location.classList.contains("truncate")).toBe(true);
  expect(location.querySelector('[dir="ltr"]')?.textContent).toBe(`${longPath}:16`);
});
