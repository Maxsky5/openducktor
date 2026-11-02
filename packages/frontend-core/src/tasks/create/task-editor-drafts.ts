import type { ComposerState } from "./task-composer-types";
import type { RetainedDescriptionAssets } from "../description/use-task-description-asset-draft";

export type RetainedTaskFields = { composer: ComposerState; baseline: ComposerState };
export type RetainedTaskDocument = {
  draftMarkdown: string;
  serverMarkdown: string;
  updatedAt: string | null;
};

export const createTaskEditorDraftState = (
  discardStaged: (workspaceId: string, assetIds: string[]) => Promise<void>,
) => {
  const descriptionAssets: RetainedDescriptionAssets = new Map();
  const fields = new Map<string, RetainedTaskFields>();
  const documents = new Map<string, RetainedTaskDocument>();
  return {
    fields,
    documents,
    descriptionAssets,
    async dispose(): Promise<void> {
      const stagedByWorkspace = new Map<string, Set<string>>();
      for (const assets of descriptionAssets.values())
        for (const [id, asset] of assets) {
          asset.revokePreviewUrl(asset.previewUrl);
          const ids = stagedByWorkspace.get(asset.workspaceId) ?? new Set<string>();
          ids.add(id);
          stagedByWorkspace.set(asset.workspaceId, ids);
        }
      fields.clear();
      documents.clear();
      descriptionAssets.clear();
      await Promise.all(
        Array.from(stagedByWorkspace, ([workspaceId, ids]) => discardStaged(workspaceId, [...ids])),
      );
    },
  };
};

export const taskEditorDraftKey = (
  workspaceId: string,
  taskId: string | null,
  artifactCode?: string,
): string => JSON.stringify([workspaceId, taskId, artifactCode ?? null]);

export const rebaseTaskComposer = (
  draft: ComposerState,
  baseline: ComposerState,
  saved: ComposerState,
): ComposerState => {
  const next = { ...saved };
  for (const field of [
    "issueType",
    "removeWorktreeOnClose",
    "title",
    "priority",
    "description",
    "labels",
  ] as const) {
    if (JSON.stringify(draft[field]) === JSON.stringify(baseline[field])) continue;
    Object.assign(next, { [field]: draft[field] });
  }
  return next;
};
