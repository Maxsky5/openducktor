import { describe, expect, mock, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { enableReactActEnvironment } from "./agent-studio-test-utils";
import { useTaskExecutionFilePreviewController } from "./use-task-execution-file-preview-controller";

enableReactActEnvironment();

const firstFile = { rootPath: "/repo", relativePath: "first.ts" };

describe("useTaskExecutionFilePreviewController", () => {
  test("keeps the current context selected until a dirty preview transition is confirmed", () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController());
    let selectedRoot = "/repo";
    const applyContextTransition = mock(() => {
      selectedRoot = "/other";
    });
    act(() => view.result.current.onSelectFile(firstFile));
    act(() => view.result.current.model.onEditStateChange({ isDirty: true, isSaving: false }));

    act(() => view.result.current.requestContextTransition(applyContextTransition));

    expect(applyContextTransition).not.toHaveBeenCalled();
    expect(selectedRoot).toBe("/repo");
    expect(view.result.current.model).toMatchObject({
      selectedFile: firstFile,
      hasPendingDiscard: true,
    });
    act(() => view.result.current.model.onKeepEditing());
    expect(view.result.current.model).toMatchObject({
      selectedFile: firstFile,
      hasPendingDiscard: false,
    });
    expect(applyContextTransition).not.toHaveBeenCalled();
    expect(selectedRoot).toBe("/repo");

    act(() => view.result.current.requestContextTransition(applyContextTransition));
    act(() => view.result.current.model.onDiscard());

    expect(applyContextTransition).toHaveBeenCalledTimes(1);
    expect(selectedRoot).toBe("/other");
    expect(view.result.current.model.selectedFile).toBeNull();
  });

  test("defers a context transition during Save and applies it after Save settles cleanly", async () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController());
    const applyContextTransition = mock(() => {});
    act(() => view.result.current.onSelectFile(firstFile));
    act(() => view.result.current.model.onEditStateChange({ isDirty: true, isSaving: true }));

    act(() => view.result.current.requestContextTransition(applyContextTransition));

    expect(applyContextTransition).not.toHaveBeenCalled();
    expect(view.result.current.model).toMatchObject({
      selectedFile: firstFile,
      hasPendingDiscard: false,
    });

    act(() => view.result.current.model.onEditStateChange({ isDirty: false, isSaving: false }));

    await waitFor(() => expect(applyContextTransition).toHaveBeenCalledTimes(1));
    expect(view.result.current.model.selectedFile).toBeNull();
  });

  test("asks before a deferred context transition when Save fails", async () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController());
    const applyContextTransition = mock(() => {});
    act(() => view.result.current.onSelectFile(firstFile));
    act(() => view.result.current.model.onEditStateChange({ isDirty: true, isSaving: true }));
    act(() => view.result.current.requestContextTransition(applyContextTransition));

    act(() => view.result.current.model.onEditStateChange({ isDirty: true, isSaving: false }));

    await waitFor(() => expect(view.result.current.model.hasPendingDiscard).toBe(true));
    expect(applyContextTransition).not.toHaveBeenCalled();
    act(() => view.result.current.model.onKeepEditing());
    expect(applyContextTransition).not.toHaveBeenCalled();
    expect(view.result.current.model.selectedFile).toEqual(firstFile);
  });
});
