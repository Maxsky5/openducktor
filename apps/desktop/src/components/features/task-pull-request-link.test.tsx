import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

const openExternalUrlMock = mock(async () => {});
const toastErrorMock = mock(() => {});

mock.module("@/lib/open-external-url", () => ({
  openExternalUrl: openExternalUrlMock,
}));

mock.module("sonner", () => ({
  toast: {
    error: toastErrorMock,
  },
}));

describe("TaskPullRequestLink", () => {
  beforeEach(() => {
    openExternalUrlMock.mockClear();
    toastErrorMock.mockClear();
  });

  test("opens the pull request URL when clicked", async () => {
    const { TaskPullRequestLink } = await import("./task-pull-request-link");
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
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
    });

    const button = renderer.root.findByType("button");
    await act(async () => {
      button.props.onClick();
    });

    expect(openExternalUrlMock).toHaveBeenCalledWith(
      "https://github.com/openai/openducktor/pull/110",
    );
  });

  test("uses merged styling for merged pull requests", async () => {
    const { TaskPullRequestLink } = await import("./task-pull-request-link");
    let renderer!: ReturnType<typeof create>;
    await act(async () => {
      renderer = create(
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
    });

    const button = renderer.root.findByType("button");
    expect(button.props.className).toContain("border-border");
    expect(button.props.className).toContain("bg-card");
    const styledChildren = renderer.root.findAll(
      (node) => typeof node.props.className === "string" && node.props.className.includes("violet"),
    );
    expect(styledChildren.length).toBeGreaterThan(0);
  });
});
