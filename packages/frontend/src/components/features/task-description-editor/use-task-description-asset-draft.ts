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

type TaskDescriptionAssetDraftState = {
  contextKey: string | null;
  uploads: TaskDescriptionAssetUpload[];
  previews: ReadonlyMap<string, string>;
};

const emptyDraftState = (contextKey: string | null): TaskDescriptionAssetDraftState => ({
  contextKey,
  uploads: [],
  previews: new Map(),
});

export const useTaskDescriptionAssetDraft = ({
  active,
  draftKey,
  workspaceId,
  stageImage,
  discardStaged,
  onDiscardError,
}: UseTaskDescriptionAssetDraftInput) => {
  const stateContextKey = active && workspaceId ? `${workspaceId}:${draftKey}` : null;
  const [draftState, setDraftState] = useState<TaskDescriptionAssetDraftState>(() =>
    emptyDraftState(stateContextKey),
  );
  if (draftState.contextKey !== stateContextKey) {
    setDraftState(emptyDraftState(stateContextKey));
  }
  const assets = useRef(new Map<string, { previewUrl: string; workspaceId: string }>());
  const context = useRef<{
    generation: number;
    key: string;
    stateKey: string;
    workspaceId: string;
  } | null>(null);
  const generation = useRef(0);
  const uploadSequence = useRef(0);

  const clearAssetRefs = useCallback((): void => {
    for (const asset of assets.current.values()) {
      URL.revokeObjectURL(asset.previewUrl);
    }
    assets.current.clear();
  }, []);

  const clearLocalAssets = useCallback((): void => {
    clearAssetRefs();
    setDraftState((current) => emptyDraftState(current.contextKey));
  }, [clearAssetRefs]);

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
      active && workspaceId && stateContextKey
        ? {
            generation: generation.current,
            key: draftKey,
            stateKey: stateContextKey,
            workspaceId,
          }
        : null;
    const previousContext = context.current;
    context.current = nextContext;
    if (
      previousContext &&
      (!nextContext ||
        previousContext.key !== nextContext.key ||
        previousContext.workspaceId !== nextContext.workspaceId)
    ) {
      const snapshot = Array.from(assets.current.entries());
      clearAssetRefs();
      void discardAssetSnapshot(snapshot).catch(onDiscardError);
    }
  }, [
    active,
    clearAssetRefs,
    discardAssetSnapshot,
    draftKey,
    onDiscardError,
    stateContextKey,
    workspaceId,
  ]);

  useEffect(
    () => () => {
      generation.current += 1;
      context.current = null;
      const snapshot = Array.from(assets.current.entries());
      clearAssetRefs();
      void discardAssetSnapshot(snapshot).catch(onDiscardError);
    },
    [clearAssetRefs, discardAssetSnapshot, onDiscardError],
  );

  const stage = useCallback(
    async (file: File): Promise<TaskAssetStageResult> => {
      const uploadContext = context.current;
      if (!uploadContext) {
        throw new Error("Select a workspace before adding task images.");
      }
      uploadSequence.current += 1;
      const uploadId = `${uploadContext.generation}:${uploadSequence.current}`;
      setDraftState((current) => {
        const next =
          current.contextKey === uploadContext.stateKey
            ? current
            : emptyDraftState(uploadContext.stateKey);
        return {
          ...next,
          uploads: [...next.uploads, { id: uploadId, fileName: file.name, status: "uploading" }],
        };
      });

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
        setDraftState((current) =>
          current.contextKey === uploadContext.stateKey
            ? {
                ...current,
                previews: new Map(
                  Array.from(assets.current, ([assetId, asset]) => [assetId, asset.previewUrl]),
                ),
                uploads: current.uploads.filter((upload) => upload.id !== uploadId),
              }
            : current,
        );
        return staged;
      } catch (cause) {
        if (context.current?.generation === uploadContext.generation) {
          setDraftState((current) =>
            current.contextKey === uploadContext.stateKey
              ? {
                  ...current,
                  uploads: current.uploads.map((upload) =>
                    upload.id === uploadId
                      ? { ...upload, status: "error", error: errorMessage(cause) }
                      : upload,
                  ),
                }
              : current,
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
    uploads: draftState.uploads,
    previews: draftState.previews,
    isUploading: draftState.uploads.some((upload) => upload.status === "uploading"),
    stage,
    stagedAssetIds,
    discardAll,
    reconcileSuccessfulSave,
  };
};
