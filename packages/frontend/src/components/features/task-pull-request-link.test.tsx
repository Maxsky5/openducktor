import { enableReactActEnvironment } from "@/test-utils/react-act-environment";
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import type { Mock } from "bun:test";
import { fireEvent, render } from "@testing-library/react";
import { createElement } from "react";
import * as sonnerActual from "sonner";
import * as externalUrlActual from "@/lib/open-external-url";

enableReactActEnvironment();

let openExternalUrlMock: Mock<typeof externalUrlActual.openExternalUrl>;
let toastErrorMock: Mock<typeof sonnerActual.toast.error>;

describe("TaskPullRequestLink", () => {
  beforeEach(() => {
    openExternalUrlMock = spyOn(externalUrlActual, "openExternalUrl").mockImplementation(
      async () => {},
    );
    toastErrorMock = spyOn(sonnerActual.toast, "error").mockImplementation(() => "toast-error");
  });

  afterEach(() => {
    openExternalUrlMock.mockRestore();
    toastErrorMock.mockRestore();
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
    const styledChildren = Array.from(rendered.container.querySelectorAll("*")).filter((node) => {
      const classAttr = node.getAttribute("class");
      return classAttr?.includes("violet");
    });
    expect(styledChildren.length).toBeGreaterThan(0);
    rendered.unmount();
  });
});
