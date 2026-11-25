import { describe, expect, mock, test } from "bun:test";
import { act, renderHook } from "@testing-library/react";
import { useTaskExecutionFilePreviewController } from "@/components/features/agents/file-preview/use-task-execution-file-preview-controller";

const firstFile = { rootPath: "/repo", relativePath: "first.ts" };
const secondFile = { rootPath: "/repo", relativePath: "second.ts" };

describe("useTaskExecutionFilePreviewController", () => {
  test("restores a clean selected file when its session returns", () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController(firstFile));
    expect(view.result.current.model.selectedFile).toEqual(firstFile);
    act(() => view.result.current.model.onClose());
    expect(view.result.current.model.selectedFile).toBeNull();
  });
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

  test("keeps a dirty preview when a confirmed branch switch fails", async () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController(firstFile));
    const first = Promise.withResolvers<boolean>();
    const retry = Promise.withResolvers<boolean>();
    const switchBranch = mock(() => retry.promise).mockImplementationOnce(() => first.promise);
    act(() => view.result.current.model.onLeavePolicyChange("confirm"));

    act(() =>
      view.result.current.requestContextTransition(switchBranch, undefined, {
        waitForSuccess: true,
      }),
    );
    await act(async () => view.result.current.model.onDiscard());
    expect(switchBranch).toHaveBeenCalledTimes(1);
    expect(view.result.current.model.selectedFile).toEqual(firstFile);
    expect(view.result.current.model.isApplyingTransition).toBe(true);

    await act(async () => first.resolve(false));
    expect(view.result.current.model.isApplyingTransition).toBe(false);
    expect(view.result.current.model.selectedFile).toEqual(firstFile);
    expect(view.result.current.model.hasPendingDiscard).toBe(false);

    act(() =>
      view.result.current.requestContextTransition(switchBranch, undefined, {
        waitForSuccess: true,
      }),
    );
    await act(async () => view.result.current.model.onDiscard());
    expect(switchBranch).toHaveBeenCalledTimes(2);
    await act(async () => retry.resolve(true));
    expect(view.result.current.model.selectedFile).toBeNull();
  });

  test("defers a context transition during Save and applies it after Save settles cleanly", () => {
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

    expect(applyContextTransition).toHaveBeenCalledTimes(1);
    expect(view.result.current.model.selectedFile).toBeNull();
  });

  test("keeps a deferred workspace preview until its switch succeeds", async () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController(firstFile));
    const first = Promise.withResolvers<boolean>();
    const retry = Promise.withResolvers<boolean>();
    const switchContext = mock(() => retry.promise).mockImplementationOnce(() => first.promise);

    act(() => view.result.current.model.onLeavePolicyChange("defer"));
    act(() =>
      view.result.current.requestContextTransition(switchContext, undefined, {
        waitForSuccess: true,
      }),
    );
    await act(async () => view.result.current.model.onLeavePolicyChange("allow"));
    expect(switchContext).toHaveBeenCalledTimes(1);
    expect(view.result.current.model.selectedFile).toEqual(firstFile);
    await act(async () => first.resolve(false));
    expect(view.result.current.model.selectedFile).toEqual(firstFile);

    act(() => view.result.current.model.onLeavePolicyChange("defer"));
    act(() =>
      view.result.current.requestContextTransition(switchContext, undefined, {
        waitForSuccess: true,
      }),
    );
    await act(async () => view.result.current.model.onLeavePolicyChange("allow"));
    expect(switchContext).toHaveBeenCalledTimes(2);
    expect(view.result.current.model.selectedFile).toEqual(firstFile);
    await act(async () => retry.resolve(true));
    expect(view.result.current.model.selectedFile).toBeNull();
  });

  test("asks before a deferred context transition when Save fails", () => {
    const view = renderHook(() => useTaskExecutionFilePreviewController());
    const applyContextTransition = mock(() => {});
    act(() => view.result.current.onSelectFile(firstFile));
    act(() => view.result.current.model.onLeavePolicyChange("defer"));
    act(() => view.result.current.requestContextTransition(applyContextTransition));

    act(() => view.result.current.model.onLeavePolicyChange("confirm"));

    expect(view.result.current.model.hasPendingDiscard).toBe(true);
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

  test("defers a forced repository transition until Save settles", () => {
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

    expect(applyTransition).toHaveBeenCalledTimes(1);
    expect(view.result.current.model.selectedFile).toBeNull();
  });

  test("applies a forced repository transition after Save fails", () => {
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

    expect(applyTransition).toHaveBeenCalledTimes(1);
    expect(cancelTransition).not.toHaveBeenCalled();
    expect(view.result.current.model.selectedFile).toBeNull();
    expect(view.result.current.model.hasPendingDiscard).toBe(false);
  });
});
