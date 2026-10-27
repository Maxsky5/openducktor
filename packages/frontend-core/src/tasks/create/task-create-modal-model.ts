import type { TaskCreateInput, TaskUpdatePatch } from "@openducktor/contracts";
import type { BuiltinDocumentCode } from "@openducktor/workflows";
import type { ComposerState, EditTaskSection } from "./task-composer-types";

export const isDocumentSection = (section: EditTaskSection): section is BuiltinDocumentCode =>
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
  section: BuiltinDocumentCode | null,
  dirtyDocuments: Record<BuiltinDocumentCode, boolean>,
): boolean => (section === null ? false : dirtyDocuments[section]);

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
