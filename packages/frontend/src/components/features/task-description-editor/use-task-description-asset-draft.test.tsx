import { describe, expect, mock, test } from "bun:test";
import {
  TASK_ASSET_MAX_DESCRIPTION_ASSETS,
  type TaskAssetStageResult,
} from "@openducktor/contracts";
import { act } from "@testing-library/react";
import { createHookHarness } from "@/test-utils/react-hook-harness";
import { useTaskDescriptionAssetDraft } from "./use-task-description-asset-draft";

const workspaceId = "9f66372b-e956-47f4-af2f-77e0df2ad4e1";
const staged: TaskAssetStageResult = {
  assetId: "550e8400-e29b-41d4-a716-446655440000",
  scope: "description",
  originalName: "diagram.png",
  verifiedMediaType: "image/png",
  byteSize: 3,
};
const ignoreDiscardError = (_cause: unknown): void => {};
const noReferencedAssets = new Set<string>();

const createDeferred = <T,>() => {
  let resolve: ((value: T) => void) | undefined;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return {
    promise,
    resolve(value: T) {
      resolve?.(value);
    },
  };
};

describe("useTaskDescriptionAssetDraft", () => {
  test("tracks upload progress and keeps per-file errors", async () => {
    const deferred = createDeferred<TaskAssetStageResult>();
    const stageImage = mock(async () => deferred.promise);
    const discardStaged = mock(async () => {});
    const harness = createHookHarness(
      ({ draftKey }: { draftKey: string }) =>
        useTaskDescriptionAssetDraft({
          active: true,
          draftKey,
          workspaceId,
          referencedAssetIds: noReferencedAssets,
          stageImage,
          discardStaged,
          onDiscardError: ignoreDiscardError,
        }),
      { draftKey: "task-1" },
    );

    await harness.mount();
    const file = new File([new Uint8Array([1, 2, 3])], "diagram.png", { type: "image/png" });
    let upload: Promise<TaskAssetStageResult> | undefined;
    await harness.run((value) => {
      upload = value.stage(file);
    });

    expect(harness.getLatest().isUploading).toBe(true);
    expect(harness.getLatest().uploads).toEqual([
      expect.objectContaining({ fileName: "diagram.png", status: "uploading" }),
    ]);

    await act(async () => {
      deferred.resolve(staged);
      await upload;
    });
    expect(harness.getLatest().isUploading).toBe(false);
    expect(harness.getLatest().stagedAssetIds()).toEqual([staged.assetId]);
    await harness.unmount();
  });

  test("discards an upload that completes after a task switch", async () => {
    const deferred = createDeferred<TaskAssetStageResult>();
    const stageImage = mock(async () => deferred.promise);
    const discardStaged = mock(async () => {});
    const harness = createHookHarness(
      ({ draftKey }: { draftKey: string }) =>
        useTaskDescriptionAssetDraft({
          active: true,
          draftKey,
          workspaceId,
          referencedAssetIds: noReferencedAssets,
          stageImage,
          discardStaged,
          onDiscardError: ignoreDiscardError,
        }),
      { draftKey: "task-1" },
    );

    await harness.mount();
    const file = new File([new Uint8Array([1])], "late.png", { type: "image/png" });
    let upload: Promise<TaskAssetStageResult> | undefined;
    await harness.run((value) => {
      upload = value.stage(file);
    });
    await harness.update({ draftKey: "task-2" });

    deferred.resolve({ ...staged, originalName: "late.png" });
    await expect(upload).rejects.toThrow("draft changed");
    expect(discardStaged).toHaveBeenCalledWith(workspaceId, [staged.assetId]);
    expect(harness.getLatest().stagedAssetIds()).toEqual([]);
    await harness.unmount();
  });

  test("retains successful staging on save failure and clears it after reconciliation", async () => {
    const stageImage = mock(async () => staged);
    const discardStaged = mock(async () => {});
    const originalCreateObjectUrl = URL.createObjectURL;
    const originalRevokeObjectUrl = URL.revokeObjectURL;
    const revokeObjectUrl = mock((_url: string) => {});
    URL.createObjectURL = () => "blob:diagram";
    URL.revokeObjectURL = revokeObjectUrl;
    const harness = createHookHarness(
      () =>
        useTaskDescriptionAssetDraft({
          active: true,
          draftKey: "task-1",
          workspaceId,
          referencedAssetIds: noReferencedAssets,
          stageImage,
          discardStaged,
          onDiscardError: ignoreDiscardError,
        }),
      {},
    );

    try {
      await harness.mount();
      await harness.run(async (value) => {
        await value.stage(new File([new Uint8Array([1])], "diagram.png", { type: "image/png" }));
      });

      expect(harness.getLatest().stagedAssetIds()).toEqual([staged.assetId]);
      expect(harness.getLatest().previews.get(staged.assetId)).toBe("blob:diagram");

      await harness.run(async (value) => {
        await value.reconcileSuccessfulSave(new Set([staged.assetId]));
      });
      expect(discardStaged).not.toHaveBeenCalled();
      expect(harness.getLatest().stagedAssetIds()).toEqual([]);
      expect(revokeObjectUrl).toHaveBeenCalledWith("blob:diagram");
    } finally {
      await harness.unmount();
      URL.createObjectURL = originalCreateObjectUrl;
      URL.revokeObjectURL = originalRevokeObjectUrl;
    }
  });

  test("keeps an actionable per-file error when staging fails", async () => {
    const stageImage = mock(async () => {
      throw new Error("The image content does not match its media type.");
    });
    const harness = createHookHarness(
      () =>
        useTaskDescriptionAssetDraft({
          active: true,
          draftKey: "task-1",
          workspaceId,
          referencedAssetIds: noReferencedAssets,
          stageImage,
          discardStaged: async () => {},
          onDiscardError: ignoreDiscardError,
        }),
      {},
    );

    await harness.mount();
    await harness.run(async (value) => {
      await expect(
        value.stage(new File([new Uint8Array([1])], "spoofed.png", { type: "image/png" })),
      ).rejects.toThrow("does not match");
    });
    expect(harness.getLatest().uploads).toEqual([
      expect.objectContaining({
        fileName: "spoofed.png",
        status: "error",
        error: "The image content does not match its media type.",
      }),
    ]);
    await harness.unmount();
  });

  test("rejects an upload before staging when the description is at its asset limit", async () => {
    const stageImage = mock(async () => staged);
    const referencedAssetIds = new Set(
      Array.from({ length: TASK_ASSET_MAX_DESCRIPTION_ASSETS }, (_, index) => `asset-${index}`),
    );
    const harness = createHookHarness(
      () =>
        useTaskDescriptionAssetDraft({
          active: true,
          draftKey: "task-1",
          workspaceId,
          referencedAssetIds,
          stageImage,
          discardStaged: async () => {},
          onDiscardError: ignoreDiscardError,
        }),
      {},
    );

    await harness.mount();
    await harness.run(async (value) => {
      await expect(
        value.stage(new File([new Uint8Array([1])], "excess.png", { type: "image/png" })),
      ).rejects.toThrow(`at most ${TASK_ASSET_MAX_DESCRIPTION_ASSETS}`);
    });
    expect(stageImage).not.toHaveBeenCalled();
    await harness.unmount();
  });

  test("reserves the last asset slot across concurrent uploads", async () => {
    const deferred = createDeferred<TaskAssetStageResult>();
    const discardStaged = mock(async () => {});
    const stageImage = mock(() => {
      if (stageImage.mock.calls.length > 1) {
        return Promise.reject(new Error("stageImage was called after the upload limit was full."));
      }
      return deferred.promise;
    });
    const referencedAssetIds = new Set(
      Array.from({ length: TASK_ASSET_MAX_DESCRIPTION_ASSETS - 1 }, (_, index) => `asset-${index}`),
    );
    const harness = createHookHarness(
      () =>
        useTaskDescriptionAssetDraft({
          active: true,
          draftKey: "task-1",
          workspaceId,
          referencedAssetIds,
          stageImage,
          discardStaged,
          onDiscardError: ignoreDiscardError,
        }),
      {},
    );

    await harness.mount();
    let firstUpload: Promise<TaskAssetStageResult> | undefined;
    await harness.run((value) => {
      firstUpload = value.stage(
        new File([new Uint8Array([1])], "last-slot.png", { type: "image/png" }),
      );
    });
    await harness.run(async (value) => {
      await expect(
        value.stage(new File([new Uint8Array([2])], "excess.png", { type: "image/png" })),
      ).rejects.toThrow(`at most ${TASK_ASSET_MAX_DESCRIPTION_ASSETS}`);
    });
    expect(stageImage).toHaveBeenCalledTimes(1);

    await act(async () => {
      deferred.resolve(staged);
      await firstUpload;
    });
    await harness.unmount();
  });
});
