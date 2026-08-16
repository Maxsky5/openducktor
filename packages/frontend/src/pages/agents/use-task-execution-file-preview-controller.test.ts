import { describe, expect, mock, test } from "bun:test";
import { act, renderHook, waitFor } from "@testing-library/react";
import { enableReactActEnvironment } from "./agent-studio-test-utils";
import { useTaskExecutionFilePreviewController } from "./use-task-execution-file-preview-controller";

enableReactActEnvironment();

const firstFile = { rootPath: "/repo", relativePath: "first.ts" };
const secondFile = { rootPath: "/repo", relativePath: "second.ts" };

describe("useTaskExecutionFilePreviewController", () => {
  test("reports whether a file selection was accepted", () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController());
    let selectionWasRejected = false;

    act(() => {
      selectionWasRejected = view.result.current.onSelectFile(firstFile) === false;
    });
    expect(selectionWasRejected).toBe(false);
    act(() => view.result.current.model.onLeavePolicyChange("confirm"));
    act(() => {
      selectionWasRejected = view.result.current.onSelectFile(secondFile) === false;
    });
    expect(selectionWasRejected).toBe(true);
    expect(view.result.current.model.selectedFile).toEqual(firstFile);

    act(() => view.result.current.model.onKeepEditing());
    act(() => view.result.current.model.onLeavePolicyChange("defer"));
    act(() => {
      selectionWasRejected = view.result.current.onSelectFile(secondFile) === false;
    });
    expect(selectionWasRejected).toBe(true);
    expect(view.result.current.model.selectedFile).toEqual(firstFile);
  });

  test("keeps the current context selected until a dirty preview transition is confirmed", () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController());
    let selectedRoot = "/repo";
    const applyContextTransition = mock(() => {
      selectedRoot = "/other";
    });
    act(() => view.result.current.onSelectFile(firstFile));
    act(() => view.result.current.model.onLeavePolicyChange("confirm"));

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
    act(() => view.result.current.model.onLeavePolicyChange("defer"));

    act(() => view.result.current.requestContextTransition(applyContextTransition));

    expect(applyContextTransition).not.toHaveBeenCalled();
    expect(view.result.current.model).toMatchObject({
      selectedFile: firstFile,
      hasPendingDiscard: false,
    });

    act(() => view.result.current.model.onLeavePolicyChange("allow"));

    await waitFor(() => expect(applyContextTransition).toHaveBeenCalledTimes(1));
    expect(view.result.current.model.selectedFile).toBeNull();
  });

  test("asks before a deferred context transition when Save fails", async () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController());
    const applyContextTransition = mock(() => {});
    act(() => view.result.current.onSelectFile(firstFile));
    act(() => view.result.current.model.onLeavePolicyChange("defer"));
    act(() => view.result.current.requestContextTransition(applyContextTransition));

    act(() => view.result.current.model.onLeavePolicyChange("confirm"));

    await waitFor(() => expect(view.result.current.model.hasPendingDiscard).toBe(true));
    expect(applyContextTransition).not.toHaveBeenCalled();
    act(() => view.result.current.model.onKeepEditing());
    expect(applyContextTransition).not.toHaveBeenCalled();
    expect(view.result.current.model.selectedFile).toEqual(firstFile);
  });

  test("coalesces a newer context transition while confirmation is pending", () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController());
    const firstApply = mock(() => {});
    const firstCancel = mock(() => {});
    const secondApply = mock(() => {});
    const secondCancel = mock(() => {});
    act(() => view.result.current.onSelectFile(firstFile));
    act(() => view.result.current.model.onLeavePolicyChange("confirm"));

    act(() => view.result.current.requestContextTransition(firstApply, firstCancel));
    act(() => view.result.current.requestContextTransition(secondApply, secondCancel));
    act(() => view.result.current.model.onDiscard());

    expect(firstApply).not.toHaveBeenCalled();
    expect(firstCancel).toHaveBeenCalledTimes(1);
    expect(secondApply).toHaveBeenCalledTimes(1);
    expect(secondCancel).not.toHaveBeenCalled();
  });

  test("cancels a blocked context transition when a file intent is pending", () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController());
    const cancelTransition = mock(() => {});
    act(() => view.result.current.onSelectFile(firstFile));
    act(() => view.result.current.model.onLeavePolicyChange("confirm"));
    act(() => view.result.current.onSelectFile({ rootPath: "/repo", relativePath: "second.ts" }));

    act(() => view.result.current.requestContextTransition(() => {}, cancelTransition));

    expect(cancelTransition).toHaveBeenCalledTimes(1);
  });

  test("force-closes a dirty preview at a repository boundary", () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController());
    const applyTransition = mock(() => {});
    act(() => view.result.current.onSelectFile(firstFile));
    act(() => view.result.current.model.onLeavePolicyChange("confirm"));

    act(() =>
      view.result.current.requestContextTransition(applyTransition, undefined, { force: true }),
    );

    expect(applyTransition).toHaveBeenCalledTimes(1);
    expect(view.result.current.model.selectedFile).toBeNull();
    expect(view.result.current.model.hasPendingDiscard).toBe(false);
  });

  test("defers a forced repository transition until Save settles", async () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController());
    const applyTransition = mock(() => {});
    act(() => view.result.current.onSelectFile(firstFile));
    act(() => view.result.current.model.onLeavePolicyChange("defer"));

    act(() =>
      view.result.current.requestContextTransition(applyTransition, undefined, { force: true }),
    );

    expect(applyTransition).not.toHaveBeenCalled();
    expect(view.result.current.model.selectedFile).toEqual(firstFile);

    act(() => view.result.current.model.onLeavePolicyChange("allow"));

    await waitFor(() => expect(applyTransition).toHaveBeenCalledTimes(1));
    expect(view.result.current.model.selectedFile).toBeNull();
  });

  test("applies a forced repository transition after Save fails", async () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController());
    const applyTransition = mock(() => {});
    const cancelTransition = mock(() => {});
    act(() => view.result.current.onSelectFile(firstFile));
    act(() => view.result.current.model.onLeavePolicyChange("defer"));

    act(() =>
      view.result.current.requestContextTransition(applyTransition, cancelTransition, {
        force: true,
      }),
    );
    act(() => view.result.current.model.onLeavePolicyChange("confirm"));

    await waitFor(() => expect(applyTransition).toHaveBeenCalledTimes(1));
    expect(cancelTransition).not.toHaveBeenCalled();
    expect(view.result.current.model.selectedFile).toBeNull();
    expect(view.result.current.model.hasPendingDiscard).toBe(false);
  });
});
