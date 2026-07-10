import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceTextFileReadResult } from "@openducktor/contracts";
import type { CodeViewOptions } from "@pierre/diffs";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  type CSSProperties,
  createElement,
  type PropsWithChildren,
  type ReactElement,
  useEffect,
  useState,
} from "react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { createQueryClient } from "@/lib/query-client";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { settingsSnapshotQueryOptions } from "@/state/queries/workspace";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import { createSettingsSnapshotFixture } from "@/test-utils/shared-test-fixtures";
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";
import type { TaskExecutionSelectedFilePreviewModel } from "./task-execution-file-preview";

enableReactActEnvironment();

type PreviewComponent =
  typeof import("./task-execution-file-preview")["TaskExecutionSelectedFilePreview"];

let TaskExecutionSelectedFilePreview: PreviewComponent;
let readTextFileMock: ReturnType<typeof mock>;
let codeViewPropsHistory: Array<{
  className: string | undefined;
  style: CSSProperties | undefined;
  options: CodeViewOptions<undefined> | undefined;
  items: Array<{ file: { contents: string } }>;
}> = [];
let codeViewMountCount = 0;
let codeViewUnmountCount = 0;
let secondFileReadMode: "pending" | "resolve" = "pending";

const CODE_VIEW_DIFFS_BACKGROUND = "light-dark(var(--diffs-light-bg), var(--diffs-dark-bg))";
const CODE_VIEW_BACKGROUND_COLOR = "var(--diffs-bg)";

const actualDiffsReact = await import("@pierre/diffs/react");
const actualHost = await import("@/state/operations/host");

const firstFile: TaskExecutionSelectedFile = {
  rootPath: "/repo",
  relativePath: "src/first.ts",
};
const secondFile: TaskExecutionSelectedFile = {
  rootPath: "/repo",
  relativePath: "src/second.ts",
};

const textFileResult = (
  selectedFile: TaskExecutionSelectedFile,
  contents: string,
): WorkspaceTextFileReadResult => ({
  kind: "text",
  rootPath: selectedFile.rootPath,
  relativePath: selectedFile.relativePath,
  contents,
  size: contents.length,
  mtimeMs: 1_760_000_000_000,
});

function PreviewTestProviders({
  children,
  theme,
}: PropsWithChildren<{ theme: "light" | "dark" }>): ReactElement {
  const [queryClient] = useState(() => {
    const client = createQueryClient();
    client.setQueryData(
      settingsSnapshotQueryOptions().queryKey,
      createSettingsSnapshotFixture({ theme }),
    );
    return client;
  });

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider defaultTheme={theme}>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}

const renderPreview = (
  model: Omit<
    TaskExecutionSelectedFilePreviewModel,
    "previewSessionKey" | "preservePreviousSnapshot"
  > & {
    previewSessionKey?: number;
    preservePreviousSnapshot?: boolean;
  },
  theme: "light" | "dark" = "light",
) => {
  const fullModel: TaskExecutionSelectedFilePreviewModel = {
    previewSessionKey: 0,
    preservePreviousSnapshot: false,
    ...model,
  };

  return (
    <PreviewTestProviders theme={theme}>
      <TaskExecutionSelectedFilePreview model={fullModel} />
    </PreviewTestProviders>
  );
};

beforeEach(async () => {
  codeViewPropsHistory = [];
  codeViewMountCount = 0;
  codeViewUnmountCount = 0;
  secondFileReadMode = "pending";

  readTextFileMock = mock((input: { rootPath: string; relativePath: string }) => {
    if (input.relativePath === secondFile.relativePath) {
      if (secondFileReadMode === "resolve") {
        return Promise.resolve(textFileResult(secondFile, "const second = true;"));
      }
      return new Promise<WorkspaceTextFileReadResult>(() => {});
    }
    return Promise.resolve(textFileResult(firstFile, "const first = true;"));
  });

  mock.module("@/state/operations/host", () => ({
    host: {
      filesystemReadTextFile: readTextFileMock,
    },
  }));

  mock.module("@pierre/diffs/react", () => ({
    CodeView: ({
      className,
      items,
      options,
      style,
    }: {
      className?: string;
      items: Array<{ file: { contents: string } }>;
      options?: CodeViewOptions<undefined>;
      style?: CSSProperties;
    }): ReactElement => {
      codeViewPropsHistory.push({ className, items, options, style });
      useEffect(() => {
        codeViewMountCount += 1;
        return () => {
          codeViewUnmountCount += 1;
        };
      }, []);
      return createElement(
        "pre",
        { "data-testid": "mock-code-view" },
        items[0]?.file.contents ?? "",
      );
    },
  }));

  ({ TaskExecutionSelectedFilePreview } = await import("./task-execution-file-preview"));
});

afterEach(async () => {
  document.documentElement.classList.remove("dark", "light");
  await restoreMockedModules([
    ["@pierre/diffs/react", async () => actualDiffsReact],
    ["@/state/operations/host", async () => actualHost],
  ]);
});

describe("TaskExecutionSelectedFilePreview", () => {
  test("uses the CodeView root as the scroll container", async () => {
    const onClose = mock(() => {});

    render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");
    const codeViewProps = codeViewPropsHistory.at(-1);
    expect(codeViewProps?.className).toContain("h-full");
    expect(codeViewProps?.className).toContain("overflow-auto");
    expect(codeViewProps?.className).toContain("[&>div]:min-h-full");
    expect(codeViewProps?.className).toContain("[&>div>div:last-child]:min-h-full");
    expect(codeViewProps?.style?.["--diffs-font-size" as keyof CSSProperties]).toBe("12px");
    expect(codeViewProps?.style?.backgroundColor).toBe(CODE_VIEW_BACKGROUND_COLOR);
    expect(codeViewProps?.style?.colorScheme).toBe("light");
  });

  test("paints the CodeView scroll root from PierreDiffs background variables", async () => {
    const onClose = mock(() => {});

    render(renderPreview({ selectedFile: firstFile, onClose }, "dark"));

    await screen.findByText("const first = true;");
    await waitFor(() => expect(codeViewPropsHistory.at(-1)?.style?.colorScheme).toBe("dark"));
    const codeViewProps = codeViewPropsHistory.at(-1);
    expect(codeViewProps?.style?.["--diffs-light-bg" as keyof CSSProperties]).toBe("#ffffff");
    expect(codeViewProps?.style?.["--diffs-dark-bg" as keyof CSSProperties]).toBe("#0a0a0a");
    expect(codeViewProps?.style?.["--diffs-bg" as keyof CSSProperties]).toBe(
      CODE_VIEW_DIFFS_BACKGROUND,
    );
    expect(codeViewProps?.style?.backgroundColor).toBe(CODE_VIEW_BACKGROUND_COLOR);
    expect(codeViewProps?.options?.unsafeCSS).toContain("background-color: var(--diffs-bg)");
  });

  test("aligns CodeView layout metrics with preview CSS", async () => {
    const onClose = mock(() => {});

    render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");
    const codeViewProps = codeViewPropsHistory.at(-1);
    expect(codeViewProps?.style?.["--diffs-line-height" as keyof CSSProperties]).toBe("18px");
    expect(codeViewProps?.style?.["--diffs-gap-block" as keyof CSSProperties]).toBe("8px");
    expect(codeViewProps?.style?.["--diffs-scrollbar-gutter-override" as keyof CSSProperties]).toBe(
      "0px",
    );
    expect(codeViewProps?.options?.itemMetrics?.lineHeight).toBe(18);
    expect(codeViewProps?.options?.itemMetrics?.spacing).toBe(8);
    expect(codeViewProps?.options?.itemMetrics?.paddingTop).toBe(8);
    expect(codeViewProps?.options?.itemMetrics?.paddingBottom).toBe(8);
    expect(codeViewProps?.options?.layout).toEqual({
      paddingTop: 0,
      paddingBottom: 0,
      gap: 0,
    });
    expect(codeViewProps?.options?.unsafeCSS).toContain(":host");
    expect(codeViewProps?.options?.unsafeCSS).toContain("[data-file]");
    expect(codeViewProps?.options?.unsafeCSS).toContain("[data-column-number]");
  });

  test("keeps the previous file visible while the next selected file is loading", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");

    view.rerender(
      renderPreview({ selectedFile: secondFile, preservePreviousSnapshot: true, onClose }),
    );

    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("src/first.ts")).toBeTruthy();
    expect(screen.getByText("const first = true;")).toBeTruthy();
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByText("Loading file...")).toBeNull();
  });

  test("does not reuse a closed preview snapshot when reopening another file", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose, previewSessionKey: 0 }));

    await screen.findByText("const first = true;");

    view.rerender(renderPreview({ selectedFile: secondFile, onClose, previewSessionKey: 1 }));

    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("src/first.ts")).toBeNull();
    expect(screen.queryByText("const first = true;")).toBeNull();
    expect(screen.getByText("src/second.ts")).toBeTruthy();
    expect(screen.getByText("Loading file...")).toBeTruthy();
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  test("does not reuse a previous snapshot when a fresh open keeps the same render key", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose, previewSessionKey: 0 }));

    await screen.findByText("const first = true;");

    view.rerender(renderPreview({ selectedFile: secondFile, onClose, previewSessionKey: 0 }));

    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("src/first.ts")).toBeNull();
    expect(screen.queryByText("const first = true;")).toBeNull();
    expect(screen.getByText("src/second.ts")).toBeTruthy();
    expect(screen.getByText("Loading file...")).toBeTruthy();
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  test("remounts CodeView when the preview session changes", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose, previewSessionKey: 0 }));

    await screen.findByText("const first = true;");
    expect(codeViewMountCount).toBe(1);

    view.rerender(renderPreview({ selectedFile: firstFile, onClose, previewSessionKey: 1 }));

    await screen.findByText("const first = true;");
    expect(codeViewMountCount).toBe(2);
    expect(codeViewUnmountCount).toBe(1);
  });

  test("remounts CodeView when the loaded file changes so scroll starts at the top", async () => {
    secondFileReadMode = "resolve";
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");
    expect(codeViewMountCount).toBe(1);

    view.rerender(renderPreview({ selectedFile: secondFile, onClose }));

    await screen.findByText("const second = true;");
    expect(codeViewMountCount).toBe(2);
    expect(codeViewUnmountCount).toBe(1);
  });

  test("closes the preview when Escape is pressed", async () => {
    const onClose = mock(() => {});

    render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
