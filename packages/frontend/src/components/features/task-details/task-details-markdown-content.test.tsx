import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, fireEvent, render as renderView, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { QueryProvider } from "@/test-utils/query-provider";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { withCapturedConsole } from "@/test-utils/console-capture";
import { createIntersectionObserverTestDriver } from "@/test-utils/intersection-observer-test-driver";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { withMockedToast } from "@/test-utils/mock-toast";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { loadMarkdownModules } from "@/test-utils/markdown-modules";
import { TaskDetailsMarkdownContent } from "./task-details-markdown-content";

await loadMarkdownModules();

const render = (element: ReactElement) => renderView(element, { wrapper: QueryProvider });

const writeClipboardMock = mock(async (_value: string) => {});
const intersectionObserver = createIntersectionObserverTestDriver();
let restoreClipboard: (() => void) | null = null;

describe("TaskDetailsMarkdownContent", () => {
  beforeEach(() => {
    intersectionObserver.install();
    writeClipboardMock.mockClear();
    writeClipboardMock.mockImplementation(async () => {});
    restoreClipboard = replaceNavigatorClipboard(writeClipboardMock);
  });

  afterEach(() => {
    intersectionObserver.restore();
    restoreClipboard?.();
    restoreClipboard = null;
  });

  test("does not render copy button when copyable markdown is missing", () => {
    const rendered = render(
      createElement(TaskDetailsMarkdownContent, {
        markdown: "# Plan\n\nText",
      }),
    );

    expect(rendered.queryByRole("button", { name: "Copy description content" })).toBeNull();
    rendered.unmount();
  });

  test("keeps leading front matter in non-description documents", () => {
    const rendered = render(
      createElement(TaskDetailsMarkdownContent, {
        markdown: "---\ntitle: Keep this specification title\n---\nSpecification body",
      }),
    );

    expect(rendered.getByText("title: Keep this specification title")).toBeDefined();
    expect(rendered.getByText("Specification body")).toBeDefined();
    rendered.unmount();
  });

  test("strips preserved front matter from task descriptions", () => {
    const rendered = render(
      createElement(TaskDetailsMarkdownContent, {
        markdown: "---\ntitle: Hidden description title\n---\nDescription body",
        stripTaskDescriptionFrontMatter: true,
      }),
    );

    expect(rendered.queryByText("title: Hidden description title")).toBeNull();
    expect(rendered.getByText("Description body")).toBeDefined();
    rendered.unmount();
  });

  test("shows error toast when clipboard copy fails", async () => {
    await withMockedToast(async ({ toastErrorMock }) => {
      const error = new DOMException("blocked by browser", "NotAllowedError");
      writeClipboardMock.mockImplementation(async () => {
        throw error;
      });

      const rendered = render(
        createElement(TaskDetailsMarkdownContent, {
          markdown: "# QA\n\nfailed",
          copyableMarkdown: "# QA\n\nfailed",
        }),
      );

      try {
        await withCapturedConsole("error", async (consoleCalls) => {
          await act(async () =>
            fireEvent.click(rendered.getByRole("button", { name: "Copy description content" })),
          );

          expect(toastErrorMock).toHaveBeenCalledWith(
            "Permission denied: clipboard access not allowed",
          );
          expect(consoleCalls).toHaveLength(1);
          expect(consoleCalls[0]?.[0]).toBe("[TaskDetailsMarkdownContent] Clipboard write failed:");
          expect(consoleCalls[0]?.[1]).toBe(error);
        });
      } finally {
        rendered.unmount();
      }
    });
  });

  test("copies the source Markdown and keeps the rendered diagram mounted", async () => {
    await withMockedToast(async ({ toastSuccessMock }) => {
      const markdown = "```mermaid\ngraph TD\n  A --> B\n```";
      const copyableMarkdown = "# Spec\n\n" + markdown;
      const connection = createTestClientConnection();
      connection.queryClient.setQueryData(
        settingsSnapshotQueryOptions().queryKey,
        createSettingsSnapshotFixture({ theme: "light" }),
      );
      const rendered = await act(async () =>
        render(
          createElement(
            QueryProvider,
            { connection },
            createElement(
              ThemeProvider,
              null,
              createElement(TaskDetailsMarkdownContent, { markdown, copyableMarkdown }),
            ),
          ),
        ),
      );

      try {
        await waitFor(() => expect(rendered.container.querySelector("svg.pele")).not.toBeNull());
        const diagram = rendered.container.querySelector("svg.pele");

        const copy = rendered.getByRole("button", { name: "Copy description content" });
        await act(async () => fireEvent.click(copy));

        expect(writeClipboardMock).toHaveBeenCalledWith(copyableMarkdown);
        expect(toastSuccessMock).toHaveBeenCalledWith("Copied!", {
          description: copyableMarkdown,
        });
        expect(rendered.container.querySelector("svg.pele")).toBe(diagram);
        expect(rendered.queryByText(/graph TD/)).toBeNull();
      } finally {
        rendered.unmount();
      }
    });
  });
});
