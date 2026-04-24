import type { TaskCreateInput, TaskUpdatePatch } from "@openducktor/contracts";
import { normalizeLines } from "@/components/features/task-composer";
import type { ComposerState, EditTaskSection } from "@/types/task-composer";

type DocumentSection = Extract<EditTaskSection, "spec" | "plan">;

export const isDocumentSection = (section: EditTaskSection): section is DocumentSection =>
  section === "spec" || section === "plan";

export const toTaskCreateInput = (state: ComposerState): TaskCreateInput => ({
  title: state.title.trim(),
  issueType: state.issueType,
  aiReviewEnabled: state.aiReviewEnabled,
  priority: state.priority,
  description: normalizeLines(state.description),
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
