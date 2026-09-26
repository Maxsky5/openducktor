import type {
  WorkspaceTextFileReadResult,
  WorkspaceTextFileWriteInput,
  WorkspaceTextFileWriteFailure,
  WorkspaceTextFileWriteResult,
} from "@openducktor/contracts";
import { HostInvokeError } from "@openducktor/host-client";
import type { CodeViewItem, FileContents } from "@pierre/diffs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useReducer, useRef } from "react";
import { errorMessage } from "@/lib/errors";
import {
  workspaceTextFileQueryOptions,
  workspaceTextFileWriteMutationOptions,
} from "@/state/queries/filesystem";
import {
  type TaskExecutionSelectedFile,
  taskExecutionSelectedFileKey,
} from "./task-execution-file-explorer-model";
import type { TaskExecutionFilePreviewLeavePolicy } from "./task-execution-file-preview";

type TextFileResult = Extract<WorkspaceTextFileReadResult, { kind: "text" }>;

type EditorSession = {
  id: string;
  branch: string | null;
  baseline: TextFileResult;
  source: TextFileResult;
  version: number;
};

type SaveFailure = {
  code: WorkspaceTextFileWriteFailure["code"] | null;
  message: string;
};

type EditorState = {
  session: EditorSession | null;
  isDirty: boolean;
  isSaving: boolean;
  saveFailure: SaveFailure | null;
  isReviewingConflict: boolean;
  conflictReview: { result: TextFileResult; branch: string | null } | null;
};

type EditorAction =
  | { type: "reset" }
  | { type: "seed"; id: string; branch: string | null; result: TextFileResult }
  | { type: "adopt_clean_result"; branch: string | null; result: TextFileResult }
  | { type: "edit"; isDirty: boolean }
  | { type: "save_started" }
  | {
      type: "save_succeeded";
      sessionId: string;
      baselineRevision: string;
      result: WorkspaceTextFileWriteResult;
      isDirty: boolean;
    }
  | {
      type: "save_failed";
      sessionId: string;
      baselineRevision: string;
      failure: SaveFailure;
    }
  | { type: "conflict_review_started" }
  | {
      type: "conflict_review_loaded";
      sessionId: string;
      baselineRevision: string;
      branch: string | null;
      result: TextFileResult;
    }
  | {
      type: "conflict_review_failed";
      sessionId: string;
      baselineRevision: string;
      message: string;
    }
  | { type: "conflict_review_closed" }
  | {
      type: "conflict_baseline_accepted";
      branch: string | null;
      result: TextFileResult;
      isDirty: boolean;
    };

const INITIAL_EDITOR_STATE: EditorState = {
  session: null,
  isDirty: false,
  isSaving: false,
  saveFailure: null,
  isReviewingConflict: false,
  conflictReview: null,
};

const editorStateReducer = (state: EditorState, action: EditorAction): EditorState => {
  switch (action.type) {
    case "reset":
      return INITIAL_EDITOR_STATE;
    case "seed":
      return {
        ...INITIAL_EDITOR_STATE,
        session: {
          id: action.id,
          branch: action.branch,
          baseline: action.result,
          source: action.result,
          version: 0,
        },
      };
    case "adopt_clean_result":
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          branch: action.branch,
          baseline: action.result,
          source: action.result,
          version: state.session.version + 1,
        },
        saveFailure: null,
        conflictReview: null,
      };
    case "edit":
      return {
        ...state,
        isDirty: action.isDirty,
        saveFailure: state.saveFailure?.code === "stale_revision" ? state.saveFailure : null,
      };
    case "save_started":
      return { ...state, isSaving: true, saveFailure: null, conflictReview: null };
    case "save_succeeded":
      if (
        !state.session ||
        state.session.id !== action.sessionId ||
        state.session.baseline.revision !== action.baselineRevision
      ) {
        return { ...state, isSaving: false };
      }
      return {
        ...state,
        session: {
          ...state.session,
          baseline: action.result,
          // Retain the saved contents for a later remount, but keep Pierre's live document
          // identity stable so Save does not drop focus, selection, or undo history.
          source: { ...action.result, revision: state.session.source.revision },
          version: state.session.version,
        },
        isDirty: action.isDirty,
        isSaving: false,
        saveFailure: null,
        conflictReview: null,
      };
    case "save_failed":
      if (
        !state.session ||
        state.session.id !== action.sessionId ||
        state.session.baseline.revision !== action.baselineRevision
      ) {
        return { ...state, isSaving: false };
      }
      return { ...state, isSaving: false, saveFailure: action.failure };
    case "conflict_review_started":
      return { ...state, isReviewingConflict: true, conflictReview: null };
    case "conflict_review_loaded":
      if (
        !state.session ||
        state.session.id !== action.sessionId ||
        state.session.baseline.revision !== action.baselineRevision
      ) {
        return state;
      }
      return {
        ...state,
        isReviewingConflict: false,
        conflictReview: { result: action.result, branch: action.branch },
      };
    case "conflict_review_failed":
      if (
        !state.session ||
        state.session.id !== action.sessionId ||
        state.session.baseline.revision !== action.baselineRevision
      ) {
        return state;
      }
      return {
        ...state,
        isReviewingConflict: false,
        saveFailure: { code: "stale_revision", message: action.message },
      };
    case "conflict_review_closed":
      return { ...state, conflictReview: null };
    case "conflict_baseline_accepted":
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
          branch: action.branch,
          baseline: action.result,
          source: { ...action.result, revision: state.session.source.revision },
        },
        isDirty: action.isDirty,
        saveFailure: null,
        conflictReview: null,
      };
  }
};

const workspaceWriteFailure = (cause: unknown): WorkspaceTextFileWriteFailure | null => {
  if (!(cause instanceof HostInvokeError) || cause.failure?.kind !== "workspace_text_file_write") {
    return null;
  }
  return cause.failure.workspaceTextFileWriteFailure;
};

type UseTaskExecutionFileEditorInput = {
  selectedFile: TaskExecutionSelectedFile | null;
  readyResult: TextFileResult | null;
  branch: string | null;
  onFileSaved(): void;
  onLeavePolicyChange(policy: TaskExecutionFilePreviewLeavePolicy): void;
};

export const useTaskExecutionFileEditor = ({
  selectedFile,
  readyResult,
  branch,
  onFileSaved,
  onLeavePolicyChange,
}: UseTaskExecutionFileEditorInput) => {
  const queryClient = useQueryClient();
  const mutation = useMutation(workspaceTextFileWriteMutationOptions(queryClient));
  const [state, dispatch] = useReducer(editorStateReducer, INITIAL_EDITOR_STATE);
  const draftRef = useRef("");
  const saveInFlightRef = useRef(false);
  const stateRef = useRef(state);
  const branchRef = useRef(branch);
  const selectedFileId = selectedFile ? taskExecutionSelectedFileKey(selectedFile) : null;
  const selectedFileIdRef = useRef(selectedFileId);

  useLayoutEffect(() => {
    selectedFileIdRef.current = selectedFileId;
  }, [selectedFileId]);

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useLayoutEffect(() => {
    branchRef.current = branch;
  }, [branch]);

  useLayoutEffect(() => {
    if (!selectedFile) {
      if (state.session) {
        draftRef.current = "";
        dispatch({ type: "reset" });
      }
      return;
    }
    const id = taskExecutionSelectedFileKey(selectedFile);
    if (state.session && state.session.id !== id) {
      draftRef.current = "";
      dispatch({ type: "reset" });
      return;
    }
    if (!readyResult) return;
    if (!state.session) {
      draftRef.current = readyResult.contents;
      dispatch({ type: "seed", id, branch, result: readyResult });
      return;
    }
    if (state.isDirty || state.isSaving || saveInFlightRef.current) {
      return;
    }
    if (
      state.session.baseline.revision === readyResult.revision &&
      state.session.branch === branch
    ) {
      return;
    }
    draftRef.current = readyResult.contents;
    dispatch({ type: "adopt_clean_result", branch, result: readyResult });
  }, [branch, readyResult, selectedFile, state.isDirty, state.isSaving, state.session]);

  useLayoutEffect(() => {
    if (state.conflictReview && state.conflictReview.branch !== branch) {
      dispatch({ type: "conflict_review_closed" });
    }
  }, [branch, state.conflictReview]);

  const onItemEditChange = useCallback(
    (item: CodeViewItem<undefined>, file: FileContents) => {
      if (!state.session || item.id !== state.session.id) return;
      draftRef.current = file.contents;
      const isDirty = file.contents !== state.session.baseline.contents;
      dispatch({ type: "edit", isDirty });
      if (!saveInFlightRef.current) {
        onLeavePolicyChange(isDirty ? "confirm" : "allow");
      }
    },
    [onLeavePolicyChange, state.session],
  );

  const hasBranchConflict = state.isDirty && state.session?.branch !== branch;
  const hasStaleConflict = state.saveFailure?.code === "stale_revision" || hasBranchConflict;

  const save = useCallback(async (): Promise<void> => {
    const session = state.session;
    if (
      !session ||
      session.id !== selectedFileId ||
      !state.isDirty ||
      hasStaleConflict ||
      session.branch !== branchRef.current ||
      saveInFlightRef.current
    ) {
      return;
    }
    saveInFlightRef.current = true;
    dispatch({ type: "save_started" });
    onLeavePolicyChange("defer");
    const baselineRevision = session.baseline.revision;
    const contentsToSave = draftRef.current;
    let didSaveActiveSession = false;
    try {
      const input: WorkspaceTextFileWriteInput = {
        rootPath: session.baseline.rootPath,
        relativePath: session.baseline.relativePath,
        contents: contentsToSave,
        revision: baselineRevision,
      };
      if (session.branch) input.expectedBranch = session.branch;
      const saved: WorkspaceTextFileWriteResult = await mutation.mutateAsync(input);
      const activeSession = stateRef.current.session;
      const saveStillMatchesActiveSession =
        selectedFileIdRef.current === session.id &&
        activeSession?.id === session.id &&
        activeSession.baseline.revision === baselineRevision;
      if (!saveStillMatchesActiveSession) {
        dispatch({
          type: "save_succeeded",
          sessionId: session.id,
          baselineRevision,
          result: saved,
          isDirty: false,
        });
        return;
      }
      const latestDraft = draftRef.current;
      const hasNewerDraft = latestDraft !== contentsToSave;
      const isDirty = hasNewerDraft && latestDraft !== saved.contents;
      if (!hasNewerDraft) {
        draftRef.current = saved.contents;
      }
      dispatch({
        type: "save_succeeded",
        sessionId: session.id,
        baselineRevision,
        result: saved,
        isDirty,
      });
      onLeavePolicyChange(isDirty ? "confirm" : "allow");
      didSaveActiveSession = true;
    } catch (cause) {
      const failure = workspaceWriteFailure(cause);
      dispatch({
        type: "save_failed",
        sessionId: session.id,
        baselineRevision,
        failure: { code: failure?.code ?? null, message: failure?.message ?? errorMessage(cause) },
      });
      const activeSession = stateRef.current.session;
      if (
        selectedFileIdRef.current === session.id &&
        activeSession?.id === session.id &&
        activeSession.baseline.revision === baselineRevision
      ) {
        onLeavePolicyChange(
          draftRef.current !== activeSession.baseline.contents ? "confirm" : "allow",
        );
      }
    } finally {
      saveInFlightRef.current = false;
    }
    if (didSaveActiveSession) {
      onFileSaved();
    }
  }, [
    mutation,
    hasStaleConflict,
    onFileSaved,
    onLeavePolicyChange,
    selectedFileId,
    state.isDirty,
    state.session,
  ]);

  const reviewLatestVersion = useCallback(async (): Promise<void> => {
    const session = state.session;
    if (!session || !hasStaleConflict || state.isReviewingConflict) {
      return;
    }
    const baselineRevision = session.baseline.revision;
    const reviewBranch = branchRef.current;
    dispatch({ type: "conflict_review_started" });
    try {
      const result = await queryClient.fetchQuery({
        ...workspaceTextFileQueryOptions(session.baseline.rootPath, session.baseline.relativePath),
        staleTime: 0,
      });
      if (result.kind !== "text") {
        throw new Error(result.message);
      }
      if (branchRef.current !== reviewBranch) {
        throw new Error("The branch changed during review. Review the file again.");
      }
      dispatch({
        type: "conflict_review_loaded",
        sessionId: session.id,
        baselineRevision,
        branch: reviewBranch,
        result,
      });
    } catch (cause) {
      dispatch({
        type: "conflict_review_failed",
        sessionId: session.id,
        baselineRevision,
        message: errorMessage(cause),
      });
    }
  }, [hasStaleConflict, queryClient, state.isReviewingConflict, state.session]);

  const closeConflictReview = useCallback(() => {
    dispatch({ type: "conflict_review_closed" });
  }, []);
  const acceptLatestBaseline = useCallback(() => {
    const review = state.conflictReview;
    if (!review || review.branch !== branchRef.current) return;
    const isDirty = draftRef.current !== review.result.contents;
    dispatch({
      type: "conflict_baseline_accepted",
      branch: review.branch,
      result: review.result,
      isDirty,
    });
    onLeavePolicyChange(isDirty ? "confirm" : "allow");
  }, [onLeavePolicyChange, state.conflictReview]);

  return useMemo(
    () => ({
      session: state.session,
      isDirty: state.isDirty,
      isSaving: state.isSaving,
      saveError:
        state.saveFailure?.message ??
        (hasBranchConflict
          ? "This draft has not been checked for the current branch. Review the file before saving."
          : null),
      hasStaleConflict,
      isReviewingConflict: state.isReviewingConflict,
      conflictReview: state.conflictReview?.result ?? null,
      onItemEditChange,
      save,
      reviewLatestVersion,
      closeConflictReview,
      acceptLatestBaseline,
    }),
    [
      acceptLatestBaseline,
      closeConflictReview,
      hasBranchConflict,
      hasStaleConflict,
      onItemEditChange,
      reviewLatestVersion,
      save,
      state,
    ],
  );
};
