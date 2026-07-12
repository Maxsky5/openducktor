import { expect, spyOn, test } from "bun:test";
import type { PullRequestReviewComment } from "@openducktor/contracts";
import { fireEvent, render } from "@testing-library/react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import * as externalUrl from "@/lib/open-external-url";
import { QueryProvider } from "@/lib/query-provider";
import { TaskExecutionCiCommentCard } from "./task-execution-ci-comment-card";

const comment: PullRequestReviewComment = {
  id: "comment-1",
  author: "reviewer",
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
};

test("opens review comments through the external URL shell bridge", () => {
  const openExternalUrlSpy = spyOn(externalUrl, "openExternalUrl").mockResolvedValue();

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

test("labels suggested changes as a distinct review section", () => {
  const view = render(
    <QueryProvider useIsolatedClient>
      <ThemeProvider defaultTheme="light">
        <TooltipProvider>
          <TaskExecutionCiCommentCard
            comment={{
              ...comment,
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
