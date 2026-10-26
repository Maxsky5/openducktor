import { normalizeTaskLabel } from "@openducktor/frontend-core/tasks/presentation/task-labels";
/**
 * Adds a typed label once, in its stored form, as the desktop label field does. An empty label
 * changes nothing.
 */
export const withLabel = (labels: readonly string[], label: string): string[] => {
  const normalized = normalizeTaskLabel(label);
  if (normalized.length === 0 || labels.includes(normalized)) return [...labels];
  return [...labels, normalized];
};

/** The workspace labels that the task does not have yet and that match the typed text. */
export const labelSuggestions = (
  knownLabels: readonly string[],
  labels: readonly string[],
  typed: string,
  limit = 8,
): string[] => {
  const query = typed.trim().toLowerCase();
  const taken = new Set(labels);
  return knownLabels
    .filter(
      (label) => !taken.has(label) && (query.length === 0 || label.toLowerCase().includes(query)),
    )
    .slice(0, limit);
};

/**
 * The desktop save rules of the task editor. A task save needs a title and waits out the type
 * step, a task conflict, and a destination error. A document save needs edited text.
 */
export const taskEditorSaveDisabled = ({
  busy,
  locked,
  documentSection,
  title,
  typeStep,
  conflict,
  destinationError,
  documentDirty,
  documentDraft,
}: {
  busy: boolean;
  /** True while a save or a recovery holds the editor. */
  locked: boolean;
  /** True when the Spec Document or the Implementation Plan is open. */
  documentSection: boolean;
  title: string;
  /** True while a new task still shows its type step. */
  typeStep: boolean;
  /** True when the live task has a newer version than the draft. */
  conflict: boolean;
  destinationError: boolean;
  documentDirty: boolean;
  documentDraft: string;
}): boolean => {
  if (busy || locked) return true;
  if (documentSection) return !documentDirty || documentDraft.trim().length === 0;
  return title.trim().length === 0 || typeStep || conflict || destinationError;
};
