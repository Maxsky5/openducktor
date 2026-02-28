import type { TaskCreateInput, TaskUpdatePatch } from "@openducktor/contracts";
import { normalizeLines } from "@/components/features/task-composer";
import type { ComposerState, EditTaskSection } from "@/types/task-composer";

export type DocumentSection = Extract<EditTaskSection, "spec" | "plan">;

export const isDocumentSection = (section: EditTaskSection): section is DocumentSection =>
  section === "spec" || section === "plan";

export const toTaskCreateInput = (
  state: ComposerState,
  canSelectParent: boolean,
): TaskCreateInput => ({
  title: state.title.trim(),
  issueType: state.issueType,
  aiReviewEnabled: state.aiReviewEnabled,
  priority: state.priority,
  description: normalizeLines(state.description),
  acceptanceCriteria: normalizeLines(state.acceptanceCriteria),
  labels: state.labels,
  parentId: !canSelectParent || state.parentId.length === 0 ? undefined : state.parentId,
});

export const toTaskUpdatePatch = (
  state: ComposerState,
  canSelectParent: boolean,
): TaskUpdatePatch => ({
  title: state.title.trim(),
  aiReviewEnabled: state.aiReviewEnabled,
  priority: state.priority,
  description: state.description.trim(),
  acceptanceCriteria: state.acceptanceCriteria.trim(),
  labels: state.labels,
  parentId: !canSelectParent ? "" : state.parentId === "__none__" ? "" : state.parentId,
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
