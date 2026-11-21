import type { TaskCreateInput, TaskUpdatePatch } from "@openducktor/contracts";
import type { WorkflowDocumentCode } from "@openducktor/workflows";
import type { ComposerState, EditTaskSection } from "./task-composer-types";

/** A save error. `outcomeUnknown` is true when the connection lost the result of the save. */
export type TaskCreateModalError = { message: string; outcomeUnknown: boolean };

export const isDocumentSection = (section: EditTaskSection): section is { artifactCode: string } =>
  section !== "details";

export const toTaskCreateInput = (state: ComposerState): TaskCreateInput => ({
  title: state.title.trim(),
  issueType: state.issueType,
  removeWorktreeOnClose: state.removeWorktreeOnClose,
  priority: state.priority,
  description: state.description.trim() || undefined,
  labels: state.labels,
});

export const toTaskUpdatePatch = (state: ComposerState): TaskUpdatePatch => ({
  title: state.title.trim(),
  removeWorktreeOnClose: state.removeWorktreeOnClose,
  priority: state.priority,
  description: state.description.trim(),
  labels: state.labels,
});

export const hasUnsavedDocumentChanges = (
  section: WorkflowDocumentCode | null,
  dirtyDocuments: Record<WorkflowDocumentCode, boolean>,
): boolean => (section === null ? false : dirtyDocuments[section] === true);

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

/**
 * The footer message. A partial save keeps its task ID and refresh steps visible until the user
 * refreshes, because the workspace and workflow messages name actions that recovery blocks.
 */
export const taskEditorFooter = ({
  isRecoveryBlocked,
  destinationError,
  workflowError,
  error,
}: {
  isRecoveryBlocked: boolean;
  destinationError: string | null;
  workflowError: string | null;
  error: TaskCreateModalError | null;
}) => {
  const blocking = isRecoveryBlocked ? null : (destinationError ?? workflowError);
  return {
    message: blocking ?? error?.message ?? null,
    outcomeUnknown: blocking === null && error?.outcomeUnknown === true,
  };
};
