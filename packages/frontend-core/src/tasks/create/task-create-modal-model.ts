import type { TaskCreateInput, TaskUpdatePatch } from "@openducktor/contracts";
import type { ComposerState, EditTaskSection } from "./task-composer-types";

type DocumentSection = Extract<EditTaskSection, "spec" | "plan">;

export const isDocumentSection = (section: EditTaskSection): section is DocumentSection =>
  section === "spec" || section === "plan";

export const toTaskCreateInput = (state: ComposerState): TaskCreateInput => ({
  title: state.title.trim(),
  issueType: state.issueType,
  aiReviewEnabled: state.aiReviewEnabled,
  priority: state.priority,
  description: state.description.trim() || undefined,
  labels: state.labels,
});

export const toTaskUpdatePatch = (state: ComposerState): TaskUpdatePatch => ({
  title: state.title.trim(),
  aiReviewEnabled: state.aiReviewEnabled,
  priority: state.priority,
  description: state.description.trim(),
  labels: state.labels,
});

export const hasUnsavedDocumentChanges = (
  section: DocumentSection | null,
  options: {
    isSpecDirty: boolean;
    isPlanDirty: boolean;
  },
): boolean => {
  if (section === "spec") {
    return options.isSpecDirty;
  }
  if (section === "plan") {
    return options.isPlanDirty;
  }
  return false;
};

/**
 * True when the live task card reports a newer document than the one the editor loaded. A card
 * that is older than the editor only lags behind a save of this editor, so it is no conflict.
 */
export const isDocumentNewerOnHost = (
  loadedUpdatedAt: string | null,
  hostUpdatedAt: string | undefined,
): boolean => {
  if (hostUpdatedAt === undefined) return false;
  if (loadedUpdatedAt === null) return true;
  return Date.parse(hostUpdatedAt) > Date.parse(loadedUpdatedAt);
};
