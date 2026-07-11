import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceTextFileReadResult } from "@openducktor/contracts";
import { QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { type PropsWithChildren, type ReactElement, useState } from "react";
import { createQueryClient } from "@/lib/query-client";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";
import type { TaskExecutionSelectedFilePreviewModel } from "./task-execution-file-preview";

enableReactActEnvironment();

type PreviewComponent =
  typeof import("./task-execution-file-preview")["TaskExecutionSelectedFilePreview"];

let TaskExecutionSelectedFilePreview: PreviewComponent;
let readTextFileMock: ReturnType<typeof mock>;
let secondFileReadMode: "pending" | "resolve" = "pending";
let previewTheme: "light" | "dark" = "light";

const actualThemeProvider = await import("@/components/layout/theme-provider");
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

const renderedCode = (): string =>
  document.querySelector<HTMLElement>(".cm-content")?.textContent ?? "";

function PreviewTestProviders({ children }: PropsWithChildren): ReactElement {
  const [queryClient] = useState(createQueryClient);

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
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
  previewTheme = theme;

  return (
    <PreviewTestProviders>
      <TaskExecutionSelectedFilePreview model={fullModel} />
    </PreviewTestProviders>
  );
};

beforeEach(async () => {
  secondFileReadMode = "pending";
  previewTheme = "light";

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

  mock.module("@/components/layout/theme-provider", () => ({
    ...actualThemeProvider,
    useTheme: () => ({
      theme: previewTheme,
      setTheme: () => {},
    }),
  }));

  ({ TaskExecutionSelectedFilePreview } = await import("./task-execution-file-preview"));
});

afterEach(async () => {
  document.documentElement.classList.remove("dark", "light");
  await restoreMockedModules([
    ["@/components/layout/theme-provider", async () => actualThemeProvider],
    ["@/state/operations/host", async () => actualHost],
  ]);
});

describe("TaskExecutionSelectedFilePreview", () => {
  test("renders the loaded file through the code preview surface", async () => {
    const onClose = mock(() => {});

    render(renderPreview({ selectedFile: firstFile, onClose }));

    await waitFor(() => expect(renderedCode()).toContain("const first = true;"));
    expect(screen.getByText("src/first.ts")).toBeTruthy();
  });

  test("keeps the previous file visible while the next selected file is loading", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }));

    await waitFor(() => expect(renderedCode()).toContain("const first = true;"));

    view.rerender(
      renderPreview({ selectedFile: secondFile, preservePreviousSnapshot: true, onClose }),
    );

    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("src/first.ts")).toBeTruthy();
    expect(renderedCode()).toContain("const first = true;");
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByText("Loading file...")).toBeNull();
  });

  test("does not reuse a closed preview snapshot when reopening another file", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose, previewSessionKey: 0 }));

    await waitFor(() => expect(renderedCode()).toContain("const first = true;"));

    view.rerender(renderPreview({ selectedFile: secondFile, onClose, previewSessionKey: 1 }));

    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("src/first.ts")).toBeNull();
    expect(renderedCode()).not.toContain("const first = true;");
    expect(screen.getByText("src/second.ts")).toBeTruthy();
    expect(screen.getByText("Loading file...")).toBeTruthy();
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  test("does not reuse a previous snapshot when a fresh open keeps the same render key", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose, previewSessionKey: 0 }));

    await waitFor(() => expect(renderedCode()).toContain("const first = true;"));

    view.rerender(renderPreview({ selectedFile: secondFile, onClose, previewSessionKey: 0 }));

    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    expect(screen.queryByText("src/first.ts")).toBeNull();
    expect(renderedCode()).not.toContain("const first = true;");
    expect(screen.getByText("src/second.ts")).toBeTruthy();
    expect(screen.getByText("Loading file...")).toBeTruthy();
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  test("replaces the code preview when the preview session changes", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose, previewSessionKey: 0 }));

    await waitFor(() => expect(renderedCode()).toContain("const first = true;"));
    const firstEditor = document.querySelector(".cm-editor");
    expect(firstEditor).toBeTruthy();

    view.rerender(renderPreview({ selectedFile: firstFile, onClose, previewSessionKey: 1 }));

    await waitFor(() => expect(document.querySelector(".cm-editor")).not.toBe(firstEditor));
    expect(renderedCode()).toContain("const first = true;");
  });

  test("replaces the code preview when the loaded file changes so scroll starts at the top", async () => {
    secondFileReadMode = "resolve";
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }));

    await waitFor(() => expect(renderedCode()).toContain("const first = true;"));
    const firstEditor = document.querySelector(".cm-editor");
    expect(firstEditor).toBeTruthy();

    view.rerender(renderPreview({ selectedFile: secondFile, onClose }));

    await waitFor(() => expect(renderedCode()).toContain("const second = true;"));
    expect(document.querySelector(".cm-editor")).not.toBe(firstEditor);
  });

  test("closes the preview when Escape is pressed", async () => {
    const onClose = mock(() => {});

    render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
