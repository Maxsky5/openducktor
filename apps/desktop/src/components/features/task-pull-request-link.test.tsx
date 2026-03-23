import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const openExternalUrlMock = mock(async () => {});
const toastErrorMock = mock(() => {});

describe("TaskPullRequestLink", () => {
  beforeAll(() => {
    mock.module("@/lib/open-external-url", () => ({
      openExternalUrl: openExternalUrlMock,
    }));
    mock.module("sonner", () => ({
      toast: {
        error: toastErrorMock,
      },
    }));
  });

  afterAll(() => {
    mock.restore();
  });

  beforeEach(() => {
    openExternalUrlMock.mockClear();
    toastErrorMock.mockClear();
  });

  test("opens the pull request URL when clicked", async () => {
    const { TaskPullRequestLink } = await import("./task-pull-request-link");
    const rendered = render(
      createElement(TaskPullRequestLink, {
        pullRequest: {
          providerId: "github",
          number: 110,
          url: "https://github.com/openai/openducktor/pull/110",
          state: "open",
          createdAt: "2026-03-12T12:24:09Z",
          updatedAt: "2026-03-12T12:24:09Z",
          lastSyncedAt: undefined,
          mergedAt: undefined,
          closedAt: undefined,
        },
      }),
    );

    fireEvent.click(rendered.getByRole("button"));

    expect(openExternalUrlMock).toHaveBeenCalledWith(
      "https://github.com/openai/openducktor/pull/110",
    );
    rendered.unmount();
  });

  test("uses merged styling for merged pull requests", async () => {
    const { TaskPullRequestLink } = await import("./task-pull-request-link");
    const rendered = render(
      createElement(TaskPullRequestLink, {
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
      }),
    );

    const button = rendered.getByRole("button");
    expect(button.className).toContain("border-border");
    expect(button.className).toContain("bg-card");
    const styledChildren = Array.from(rendered.container.querySelectorAll("*")).filter((node) =>
      node.className.includes("violet"),
    );
    expect(styledChildren.length).toBeGreaterThan(0);
    rendered.unmount();
  });
});
