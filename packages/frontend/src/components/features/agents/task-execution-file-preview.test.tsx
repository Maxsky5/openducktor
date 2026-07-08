import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import type { WorkspaceTextFileReadResult } from "@openducktor/contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement, type ReactElement } from "react";
import { ThemeProvider } from "@/components/layout/theme-provider";
import { QueryProvider } from "@/lib/query-provider";
import { enableReactActEnvironment } from "@/pages/agents/agent-studio-test-utils";
import { restoreMockedModules } from "@/test-utils/mock-module-cleanup";
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";
import type { TaskExecutionSelectedFilePreviewModel } from "./task-execution-file-preview";

enableReactActEnvironment();

type PreviewComponent =
  typeof import("./task-execution-file-preview")["TaskExecutionSelectedFilePreview"];

let TaskExecutionSelectedFilePreview: PreviewComponent;
let readTextFileMock: ReturnType<typeof mock>;

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

const renderPreview = (model: TaskExecutionSelectedFilePreviewModel) =>
  createElement(
    QueryProvider,
    { useIsolatedClient: true },
    createElement(ThemeProvider, null, createElement(TaskExecutionSelectedFilePreview, { model })),
  );

beforeEach(async () => {
  readTextFileMock = mock((input: { rootPath: string; relativePath: string }) => {
    if (input.relativePath === secondFile.relativePath) {
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
    CodeView: ({ items }: { items: Array<{ file: { contents: string } }> }): ReactElement =>
      createElement("pre", { "data-testid": "mock-code-view" }, items[0]?.file.contents ?? ""),
  }));

  ({ TaskExecutionSelectedFilePreview } = await import("./task-execution-file-preview"));
});

afterEach(async () => {
  await restoreMockedModules([
    ["@pierre/diffs/react", async () => actualDiffsReact],
    ["@/state/operations/host", async () => actualHost],
  ]);
});

describe("TaskExecutionSelectedFilePreview", () => {
  test("keeps the previous file visible while the next selected file is loading", async () => {
    const onClose = mock(() => {});
    const view = render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");

    view.rerender(renderPreview({ selectedFile: secondFile, onClose }));

    await waitFor(() => expect(readTextFileMock).toHaveBeenCalledTimes(2));
    expect(screen.getByText("src/first.ts")).toBeTruthy();
    expect(screen.getByText("const first = true;")).toBeTruthy();
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByText("Loading file...")).toBeNull();
  });

  test("closes the preview when Escape is pressed", async () => {
    const onClose = mock(() => {});

    render(renderPreview({ selectedFile: firstFile, onClose }));

    await screen.findByText("const first = true;");
    fireEvent.keyDown(window, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
