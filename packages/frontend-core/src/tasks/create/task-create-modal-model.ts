import type { TaskCreateInput, TaskUpdatePatch } from "@openducktor/contracts";
import type {
  WorkflowIssueTypeId as IssueType,
  ResolvedTaskCard as TaskCard,
  TaskWorkflow,
  WorkflowDocumentCode,
} from "@openducktor/workflows";
import type { Dispatch } from "react";
import { isOutcomeUnknown } from "../../lib/command-outcome";
import { errorMessage } from "../../lib/errors";
import type { ComposerState, EditTaskSection } from "./task-composer-types";
import {
  type DocumentSection,
  EXTERNAL_DOCUMENT_CONFLICT_MESSAGE,
  type TaskCreateModalAction,
  type TaskCreateModalError,
} from "./task-create-modal-state";

export const isDocumentSection = (section: EditTaskSection): section is { artifactCode: string } =>
  section !== "details";

/** Without a workflow ID, the host creates the task with the default workflow of the repository. */
export const toTaskCreateInput = (state: ComposerState, workflowId?: string): TaskCreateInput => {
  const input: TaskCreateInput = {
    title: state.title.trim(),
    issueType: state.issueType,
    removeWorktreeOnClose: state.removeWorktreeOnClose,
    priority: state.priority,
    description: state.description.trim() || undefined,
    labels: state.labels,
  };
  if (workflowId !== undefined) input.workflowId = workflowId;
  return input;
};

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

/** Why the form cannot create or save the task now, or null. */
export const submitBlocker = (
  taskWorkflow: TaskWorkflow | undefined,
  workflowError: string | null,
  issueType: IssueType,
): string | null => {
  if (workflowError) return workflowError;
  if (!taskWorkflow?.definition.issueTypes.some(({ id }) => id === issueType))
    return "Select an issue type from the task workflow.";
  return null;
};

/** Why a document cannot save while the task workflow is missing, or null. */
export const documentWorkflowBlocker = (
  taskWorkflow: TaskWorkflow | undefined,
  workflowError: string | null,
): string | null => {
  if (workflowError) return workflowError;
  return taskWorkflow ? null : "Task workflow is loading.";
};

/**
 * Saves the open document of a task. The live task card carries the version of each document, so
 * a save never overwrites a newer document from an agent or another client.
 */
export const saveTaskEditorDocument = async ({
  task,
  section,
  document,
  blocker,
  dispatch,
  saveTaskDocument,
  applySavedDocument,
}: {
  task: TaskCard | null;
  section: DocumentSection | null;
  document:
    | { readonly updatedAt: string | null; readonly draftMarkdown: string }
    | null
    | undefined;
  blocker: string | null;
  dispatch: Dispatch<TaskCreateModalAction>;
  saveTaskDocument: (
    taskId: string,
    code: string,
    markdown: string,
  ) => Promise<{ updatedAt: string }>;
  applySavedDocument: (section: DocumentSection, markdown: string, updatedAt: string) => void;
}): Promise<void> => {
  if (!task || !section || !document) return;
  const failure =
    blocker ??
    (isDocumentNewerOnHost(document.updatedAt, task.artifactSummary[section]?.updatedAt)
      ? EXTERNAL_DOCUMENT_CONFLICT_MESSAGE
      : null);
  if (failure !== null) {
    dispatch({ type: "documentSaveFailed", error: { message: failure, outcomeUnknown: false } });
    return;
  }
  const markdown = document.draftMarkdown.trim();
  dispatch({ type: "documentSaveStarted", section });
  try {
    const saved = await saveTaskDocument(task.id, section, markdown);
    applySavedDocument(section, markdown, saved.updatedAt);
  } catch (reason) {
    dispatch({
      type: "documentSaveFailed",
      error: { message: errorMessage(reason), outcomeUnknown: isOutcomeUnknown(reason) },
    });
  } finally {
    dispatch({ type: "documentSaveFinished" });
  }
};
