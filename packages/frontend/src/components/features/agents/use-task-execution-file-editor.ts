import type {
  WorkspaceTextFileReadResult,
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
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";
import type { TaskExecutionFilePreviewLeavePolicy } from "./task-execution-file-preview";

type TextFileResult = Extract<WorkspaceTextFileReadResult, { kind: "text" }>;

type EditorSession = {
  id: string;
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
  conflictReview: TextFileResult | null;
};

type EditorAction =
  | { type: "seed"; id: string; result: TextFileResult }
  | { type: "adopt_clean_result"; result: TextFileResult }
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
      result: TextFileResult;
    }
  | {
      type: "conflict_review_failed";
      sessionId: string;
      baselineRevision: string;
      message: string;
    }
  | { type: "conflict_review_closed" }
  | { type: "conflict_baseline_accepted"; result: TextFileResult; isDirty: boolean };

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
    case "seed":
      return {
        ...INITIAL_EDITOR_STATE,
        session: { id: action.id, baseline: action.result, source: action.result, version: 0 },
      };
    case "adopt_clean_result":
      if (!state.session) return state;
      return {
        ...state,
        session: {
          ...state.session,
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
      return { ...state, isReviewingConflict: false, conflictReview: action.result };
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
        session: { ...state.session, baseline: action.result },
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
  onLeavePolicyChange(policy: TaskExecutionFilePreviewLeavePolicy): void;
};

export const useTaskExecutionFileEditor = ({
  selectedFile,
  readyResult,
  onLeavePolicyChange,
}: UseTaskExecutionFileEditorInput) => {
  const queryClient = useQueryClient();
  const mutation = useMutation(workspaceTextFileWriteMutationOptions(queryClient));
  const [state, dispatch] = useReducer(editorStateReducer, INITIAL_EDITOR_STATE);
  const draftRef = useRef("");
  const saveInFlightRef = useRef(false);
  const stateRef = useRef(state);
  const selectedFileId = selectedFile
    ? `${selectedFile.rootPath}:${selectedFile.relativePath}`
    : null;
  const selectedFileIdRef = useRef(selectedFileId);

  useLayoutEffect(() => {
    selectedFileIdRef.current = selectedFileId;
  }, [selectedFileId]);

  useLayoutEffect(() => {
    stateRef.current = state;
  }, [state]);

  useLayoutEffect(() => {
    if (!selectedFile || !readyResult) return;
    const id = `${selectedFile.rootPath}:${selectedFile.relativePath}`;
    if (!state.session || state.session.id !== id) {
      draftRef.current = readyResult.contents;
      dispatch({ type: "seed", id, result: readyResult });
      return;
    }
    if (
      state.session.baseline.revision === readyResult.revision ||
      state.isDirty ||
      state.isSaving ||
      saveInFlightRef.current
    ) {
      return;
    }
    draftRef.current = readyResult.contents;
    dispatch({ type: "adopt_clean_result", result: readyResult });
  }, [readyResult, selectedFile, state.isDirty, state.isSaving, state.session]);

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

  const save = useCallback(async (): Promise<void> => {
    const session = state.session;
    if (
      !session ||
      session.id !== selectedFileId ||
      !state.isDirty ||
      state.saveFailure?.code === "stale_revision" ||
      saveInFlightRef.current
    ) {
      return;
    }
    saveInFlightRef.current = true;
    dispatch({ type: "save_started" });
    onLeavePolicyChange("defer");
    const baselineRevision = session.baseline.revision;
    const contentsToSave = draftRef.current;
    try {
      const saved: WorkspaceTextFileWriteResult = await mutation.mutateAsync({
        rootPath: session.baseline.rootPath,
        relativePath: session.baseline.relativePath,
        contents: contentsToSave,
        revision: baselineRevision,
      });
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
      if (!hasNewerDraft) draftRef.current = saved.contents;
      dispatch({
        type: "save_succeeded",
        sessionId: session.id,
        baselineRevision,
        result: saved,
        isDirty,
      });
      onLeavePolicyChange(isDirty ? "confirm" : "allow");
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
  }, [
    mutation,
    onLeavePolicyChange,
    selectedFileId,
    state.isDirty,
    state.saveFailure?.code,
    state.session,
  ]);

  const reviewLatestVersion = useCallback(async (): Promise<void> => {
    const session = state.session;
    if (!session || state.saveFailure?.code !== "stale_revision" || state.isReviewingConflict) {
      return;
    }
    const baselineRevision = session.baseline.revision;
    dispatch({ type: "conflict_review_started" });
    try {
      const result = await queryClient.fetchQuery({
        ...workspaceTextFileQueryOptions(session.baseline.rootPath, session.baseline.relativePath),
        staleTime: 0,
      });
      if (result.kind !== "text") {
        throw new Error(result.message);
      }
      dispatch({
        type: "conflict_review_loaded",
        sessionId: session.id,
        baselineRevision,
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
  }, [queryClient, state.isReviewingConflict, state.saveFailure?.code, state.session]);

  const closeConflictReview = useCallback(() => {
    dispatch({ type: "conflict_review_closed" });
  }, []);
  const acceptLatestBaseline = useCallback(() => {
    if (!state.conflictReview) return;
    const isDirty = draftRef.current !== state.conflictReview.contents;
    dispatch({
      type: "conflict_baseline_accepted",
      result: state.conflictReview,
      isDirty,
    });
    onLeavePolicyChange(isDirty ? "confirm" : "allow");
  }, [onLeavePolicyChange, state.conflictReview]);

  return useMemo(
    () => ({
      session: state.session,
      isDirty: state.isDirty,
      isSaving: state.isSaving,
      saveError: state.saveFailure?.message ?? null,
      hasStaleConflict: state.saveFailure?.code === "stale_revision",
      isReviewingConflict: state.isReviewingConflict,
      conflictReview: state.conflictReview,
      onItemEditChange,
      save,
      reviewLatestVersion,
      closeConflictReview,
      acceptLatestBaseline,
    }),
    [acceptLatestBaseline, closeConflictReview, onItemEditChange, reviewLatestVersion, save, state],
  );
};
