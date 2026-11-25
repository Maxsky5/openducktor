import type { TaskAssetFailure } from "@openducktor/contracts";
import type {
  WorkflowIssueTypeId as IssueType,
  ResolvedTaskCard as TaskCard,
} from "@openducktor/workflows";
import { toComposerState } from "./task-composer-options";
import type { ComposerState, ComposerStep, EditTaskSection } from "./task-composer-types";
import type { RetainedTaskWorkspace } from "./task-editor-drafts";
import type { TaskDocumentSection } from "./use-task-document-editor-state";

// The state of the New task and Edit task form, and its reducer.

export type DocumentSection = TaskDocumentSection;

export type PendingDiscardIntent =
  | { type: "close-modal" }
  | { type: "switch-section"; next: EditTaskSection };

/** A save error. `outcomeUnknown` is true when the connection lost the result of the save. */
export type TaskCreateModalError = { message: string; outcomeUnknown: boolean };

export type TaskCreateModalState = {
  step: ComposerStep;
  editSection: EditTaskSection;
  composer: ComposerState;
  selectedCreateIssueType: IssueType | null;
  /** The workflow that a new task uses. Null selects the default workflow of the repository. */
  selectedWorkflowId: string | null;
  error: TaskCreateModalError | null;
  documentError: TaskCreateModalError | null;
  isSubmitting: boolean;
  isSavingDocument: DocumentSection | null;
  pendingDiscardIntent: PendingDiscardIntent | null;
  taskAssetFailure: TaskAssetFailure | null;
  /** The workspace that the user picked for a new task, or null for its destination. */
  workspacePick: RetainedTaskWorkspace | null;
};

export type TaskCreateModalAction =
  | {
      type: "resetForOpenTask";
      task: TaskCard | null;
      initialTitle: string;
      initialEditSection: EditTaskSection;
      initialWorkflowId: string | null;
      composer?: ComposerState;
      workspacePick: RetainedTaskWorkspace | null;
    }
  | { type: "externalTaskApplied"; composer: ComposerState }
  | { type: "composerPatched"; patch: Partial<ComposerState> }
  | {
      type: "issueTypeSelected";
      issueType: IssueType;
      /** The workflow that takes the type, or null to keep the current one. */
      workflowId: string | null;
      /** The workflow step when several workflows take the type, else the details. */
      next: ComposerStep;
    }
  | { type: "workflowSelected"; workflowId: string }
  | {
      type: "createWorkspaceChanged";
      workspace: RetainedTaskWorkspace;
      /** True when the next workspace offers the chosen workflow and it takes the chosen type. */
      keepsChoice: boolean;
    }
  | { type: "stepChanged"; step: ComposerStep }
  | { type: "documentErrorCleared" }
  | { type: "discardIntentSet"; intent: PendingDiscardIntent }
  | { type: "sectionChanged"; section: EditTaskSection }
  | { type: "submitBlocked"; error: string }
  | { type: "submitStarted" }
  | {
      type: "submitFailed";
      error: TaskCreateModalError;
      taskAssetFailure: TaskAssetFailure | null;
    }
  | { type: "submitFinished" }
  | { type: "documentSaveStarted"; section: DocumentSection }
  | { type: "documentSaveFailed"; error: TaskCreateModalError }
  | { type: "documentSaveFinished" }
  | { type: "discardIntentCleared" };

/** The composer that an editor starts from: the saved task, or a new task with its title. */
export const startComposer = (task: TaskCard | null, initialTitle: string): ComposerState =>
  task ? toComposerState(task) : { ...toComposerState(null), title: initialTitle };

export const initialTaskCreateModalState = (
  task: TaskCard | null,
  initialTitle = "",
  initialEditSection: EditTaskSection = "details",
  initialWorkflowId: string | null = null,
): TaskCreateModalState => ({
  step: task ? "details" : "type",
  editSection: task ? initialEditSection : "details",
  composer: startComposer(task, initialTitle),
  selectedCreateIssueType: task?.issueType ?? null,
  selectedWorkflowId: task ? null : initialWorkflowId,
  error: null,
  documentError: null,
  isSubmitting: false,
  isSavingDocument: null,
  pendingDiscardIntent: null,
  taskAssetFailure: null,
  workspacePick: null,
});

export const areComposerStatesEqual = (left: ComposerState, right: ComposerState): boolean =>
  left.issueType === right.issueType &&
  left.removeWorktreeOnClose === right.removeWorktreeOnClose &&
  left.title === right.title &&
  left.priority === right.priority &&
  left.description === right.description &&
  left.labels.length === right.labels.length &&
  left.labels.every((label, index) => label === right.labels[index]);

export const EXTERNAL_DOCUMENT_CONFLICT_MESSAGE =
  "This document changed on the host while you were editing. Your edits are kept. Copy what you need, then close and reopen the task to load the latest version.";

export const taskCreateModalReducer = (
  state: TaskCreateModalState,
  action: TaskCreateModalAction,
): TaskCreateModalState => {
  switch (action.type) {
    case "resetForOpenTask":
      return {
        ...initialTaskCreateModalState(
          action.task,
          action.initialTitle,
          action.initialEditSection,
          action.initialWorkflowId,
        ),
        composer: action.composer ?? startComposer(action.task, action.initialTitle),
        workspacePick: action.workspacePick,
      };
    case "externalTaskApplied":
      return {
        ...state,
        composer: action.composer,
        selectedCreateIssueType: action.composer.issueType,
        error: null,
        taskAssetFailure: null,
      };
    case "composerPatched":
      return { ...state, composer: { ...state.composer, ...action.patch } };
    case "issueTypeSelected":
      return {
        ...state,
        selectedCreateIssueType: action.issueType,
        selectedWorkflowId: action.workflowId ?? state.selectedWorkflowId,
        composer: { ...state.composer, issueType: action.issueType },
        step: action.next,
      };
    case "workflowSelected":
      // The type comes first, and the picker offers only the workflows that take it.
      return { ...state, selectedWorkflowId: action.workflowId };
    case "stepChanged":
      return { ...state, step: action.step };
    // Each workspace enables its own workflows. When the next one does not offer the chosen
    // workflow for the chosen type, the user picks the type and the workflow again.
    case "createWorkspaceChanged":
      if (action.keepsChoice) return { ...state, workspacePick: action.workspace, error: null };
      return {
        ...state,
        workspacePick: action.workspace,
        step: "type",
        selectedCreateIssueType: null,
        selectedWorkflowId: null,
        error: null,
      };
    case "documentErrorCleared":
      return { ...state, documentError: null };
    case "discardIntentSet":
      return { ...state, pendingDiscardIntent: action.intent };
    case "sectionChanged":
      return { ...state, editSection: action.section, documentError: null };
    case "submitBlocked":
      return { ...state, error: { message: action.error, outcomeUnknown: false } };
    case "submitStarted":
      return {
        ...state,
        error: null,
        documentError: null,
        taskAssetFailure: null,
        isSubmitting: true,
      };
    case "submitFailed":
      return { ...state, error: action.error, taskAssetFailure: action.taskAssetFailure };
    case "submitFinished":
      return { ...state, isSubmitting: false };
    case "documentSaveStarted":
      return { ...state, error: null, documentError: null, isSavingDocument: action.section };
    case "documentSaveFailed":
      return { ...state, documentError: action.error };
    case "documentSaveFinished":
      return { ...state, isSavingDocument: null };
    case "discardIntentCleared":
      return { ...state, pendingDiscardIntent: null };
  }
};
