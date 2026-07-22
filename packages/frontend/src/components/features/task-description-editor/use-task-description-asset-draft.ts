import type { TaskAssetStageResult } from "@openducktor/contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";

export type TaskDescriptionAssetUpload = {
  id: string;
  fileName: string;
  status: "uploading" | "error";
  error?: string;
};

type UseTaskDescriptionAssetDraftInput = {
  active: boolean;
  draftKey: string;
  workspaceId: string | null;
  stageImage(file: File): Promise<TaskAssetStageResult>;
  discardStaged(workspaceId: string, assetIds: string[]): Promise<void>;
  onDiscardError(cause: unknown): void;
};

export const useTaskDescriptionAssetDraft = ({
  active,
  draftKey,
  workspaceId,
  stageImage,
  discardStaged,
  onDiscardError,
}: UseTaskDescriptionAssetDraftInput) => {
  const [uploads, setUploads] = useState<TaskDescriptionAssetUpload[]>([]);
  const [previews, setPreviews] = useState<ReadonlyMap<string, string>>(() => new Map());
  const assets = useRef(new Map<string, { previewUrl: string; workspaceId: string }>());
  const context = useRef<{ generation: number; key: string; workspaceId: string } | null>(null);
  const generation = useRef(0);
  const uploadSequence = useRef(0);

  const clearLocalAssets = useCallback((): void => {
    for (const asset of assets.current.values()) {
      URL.revokeObjectURL(asset.previewUrl);
    }
    assets.current.clear();
    setPreviews(new Map());
    setUploads([]);
  }, []);

  const discardAssetSnapshot = useCallback(
    async (
      snapshot: Array<[string, { previewUrl: string; workspaceId: string }]>,
    ): Promise<void> => {
      const idsByWorkspace = new Map<string, string[]>();
      for (const [assetId, asset] of snapshot) {
        const ids = idsByWorkspace.get(asset.workspaceId) ?? [];
        ids.push(assetId);
        idsByWorkspace.set(asset.workspaceId, ids);
      }
      await Promise.all(
        Array.from(idsByWorkspace, ([assetWorkspaceId, assetIds]) =>
          discardStaged(assetWorkspaceId, assetIds),
        ),
      );
    },
    [discardStaged],
  );

  useEffect(() => {
    generation.current += 1;
    const nextContext =
      active && workspaceId ? { generation: generation.current, key: draftKey, workspaceId } : null;
    const previousContext = context.current;
    context.current = nextContext;
    if (
      previousContext &&
      (!nextContext ||
        previousContext.key !== nextContext.key ||
        previousContext.workspaceId !== nextContext.workspaceId)
    ) {
      const snapshot = Array.from(assets.current.entries());
      clearLocalAssets();
      void discardAssetSnapshot(snapshot).catch(onDiscardError);
    }
  }, [active, clearLocalAssets, discardAssetSnapshot, draftKey, onDiscardError, workspaceId]);

  useEffect(
    () => () => {
      generation.current += 1;
      context.current = null;
      const snapshot = Array.from(assets.current.entries());
      for (const asset of assets.current.values()) {
        URL.revokeObjectURL(asset.previewUrl);
      }
      assets.current.clear();
      void discardAssetSnapshot(snapshot).catch(onDiscardError);
    },
    [discardAssetSnapshot, onDiscardError],
  );

  const stage = useCallback(
    async (file: File): Promise<TaskAssetStageResult> => {
      const uploadContext = context.current;
      if (!uploadContext) {
        throw new Error("Select a workspace before adding task images.");
      }
      uploadSequence.current += 1;
      const uploadId = `${uploadContext.generation}:${uploadSequence.current}`;
      setUploads((current) => [
        ...current,
        { id: uploadId, fileName: file.name, status: "uploading" },
      ]);

      try {
        const staged = await stageImage(file);
        const currentContext = context.current;
        if (
          !currentContext ||
          currentContext.generation !== uploadContext.generation ||
          currentContext.key !== uploadContext.key ||
          currentContext.workspaceId !== uploadContext.workspaceId
        ) {
          await discardStaged(uploadContext.workspaceId, [staged.assetId]);
          throw new Error("The task description draft changed before the image upload finished.");
        }

        const previewUrl = URL.createObjectURL(file);
        assets.current.set(staged.assetId, {
          previewUrl,
          workspaceId: uploadContext.workspaceId,
        });
        setPreviews(
          new Map(Array.from(assets.current, ([assetId, asset]) => [assetId, asset.previewUrl])),
        );
        setUploads((current) => current.filter((upload) => upload.id !== uploadId));
        return staged;
      } catch (cause) {
        if (context.current?.generation === uploadContext.generation) {
          setUploads((current) =>
            current.map((upload) =>
              upload.id === uploadId
                ? { ...upload, status: "error", error: errorMessage(cause) }
                : upload,
            ),
          );
        }
        throw cause;
      }
    },
    [discardStaged, stageImage],
  );

  const stagedAssetIds = useCallback((): string[] => Array.from(assets.current.keys()), []);

  const discardAll = useCallback(async (): Promise<void> => {
    const snapshot = Array.from(assets.current.entries());
    await discardAssetSnapshot(snapshot);
    clearLocalAssets();
  }, [clearLocalAssets, discardAssetSnapshot]);

  const reconcileSuccessfulSave = useCallback(
    async (referencedAssetIds: ReadonlySet<string>): Promise<void> => {
      const unreferenced = Array.from(assets.current.entries()).filter(
        ([assetId]) => !referencedAssetIds.has(assetId),
      );
      try {
        await discardAssetSnapshot(unreferenced);
      } finally {
        clearLocalAssets();
      }
    },
    [clearLocalAssets, discardAssetSnapshot],
  );

  return {
    uploads,
    previews,
    isUploading: uploads.some((upload) => upload.status === "uploading"),
    stage,
    stagedAssetIds,
    discardAll,
    reconcileSuccessfulSave,
  };
};
