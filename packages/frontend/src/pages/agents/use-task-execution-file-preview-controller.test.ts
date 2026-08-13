import { describe, expect, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { enableReactActEnvironment } from "./agent-studio-test-utils";
import { useTaskExecutionFilePreviewController } from "./use-task-execution-file-preview-controller";

enableReactActEnvironment();

const firstFile = { rootPath: "/repo", relativePath: "first.ts" };

describe("useTaskExecutionFilePreviewController", () => {
  test("keeps a dirty preview mounted until a context change is confirmed", () => {
    const view = renderHook(
      ({ contextKey }) => useTaskExecutionFilePreviewController({ contextKey }),
      { initialProps: { contextKey: "task-1\0session-1\0/repo" } },
    );
    act(() => view.result.current.onSelectFile(firstFile));
    act(() => view.result.current.model.onEditStateChange({ isDirty: true, isSaving: false }));

    view.rerender({ contextKey: "task-2\0session-2\0/other" });

    expect(view.result.current.model).toMatchObject({
      selectedFile: firstFile,
      hasPendingDiscard: true,
    });
    act(() => view.result.current.model.onKeepEditing());
    expect(view.result.current.model).toMatchObject({
      selectedFile: firstFile,
      hasPendingDiscard: false,
    });
  });

  test("does not close a preview when context changes during Save", () => {
    const view = renderHook(
      ({ contextKey }) => useTaskExecutionFilePreviewController({ contextKey }),
      { initialProps: { contextKey: "task-1\0session-1\0/repo" } },
    );
    act(() => view.result.current.onSelectFile(firstFile));
    act(() => view.result.current.model.onEditStateChange({ isDirty: true, isSaving: true }));

    view.rerender({ contextKey: "task-2\0session-2\0/other" });

    expect(view.result.current.model).toMatchObject({
      selectedFile: firstFile,
      hasPendingDiscard: false,
    });
  });
});
