import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { act, fireEvent, render as renderView } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { MermaidSvgCacheProvider } from "@/components/ui/markdown-mermaid-svg-cache-context";
import { QueryProvider } from "@/test-utils/query-provider";
import { settingsSnapshotQueryOptions } from "@openducktor/frontend-core/queries/workspace";
import { withAnimationFrameTestDriver } from "@openducktor/frontend-core/test-support/animation-frame-test-driver";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { withCapturedConsole } from "@/test-utils/console-capture";
import { createIntersectionObserverTestDriver } from "@/test-utils/intersection-observer-test-driver";
import { replaceNavigatorClipboard } from "@/test-utils/mock-clipboard";
import { withMockedToast } from "@/test-utils/mock-toast";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import { TaskDetailsMarkdownContent } from "./task-details-markdown-content";

const mermaidRenderModule = await import("@/components/ui/markdown-mermaid-render");
await import("@/components/ui/markdown-renderer-mermaid-candidate");

const render = (element: ReactElement) => renderView(element, { wrapper: MermaidSvgCacheProvider });

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
    const renderSpy = spyOn(mermaidRenderModule, "renderMermaidSvg").mockResolvedValue(
      '<svg xmlns="http://www.w3.org/2000/svg"><text>Diagram</text></svg>',
    );

    try {
      await withMockedToast(({ toastSuccessMock }) =>
        withAnimationFrameTestDriver(async (frames) => {
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
            await frames.flushFrames();
            const diagram = rendered.getByText("Diagram").closest("svg");
            expect(diagram).not.toBeNull();
            expect(renderSpy).toHaveBeenCalledTimes(1);

            const copy = rendered.getByRole("button", { name: "Copy description content" });
            await act(async () => fireEvent.click(copy));

            expect(writeClipboardMock).toHaveBeenCalledWith(copyableMarkdown);
            expect(toastSuccessMock).toHaveBeenCalledWith("Copied!", {
              description: copyableMarkdown,
            });
            expect(rendered.getByText("Diagram").closest("svg")).toBe(diagram);
            expect(rendered.queryByText(/graph TD/)).toBeNull();
            expect(renderSpy).toHaveBeenCalledTimes(1);
          } finally {
            rendered.unmount();
          }
        }),
      );
    } finally {
      renderSpy.mockRestore();
    }
    // This test renders a full task document with rich Markdown.
  }, 5_000);
});
