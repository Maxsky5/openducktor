import type {
  WorkspaceTextFileReadResult,
  WorkspaceTextFileWriteResult,
} from "@openducktor/contracts";
import type { CodeViewItem, FileContents } from "@pierre/diffs";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { errorMessage } from "@/lib/errors";
import { workspaceTextFileWriteMutationOptions } from "@/state/queries/filesystem";
import type { TaskExecutionSelectedFile } from "./task-execution-file-explorer-model";

type TextFileResult = Extract<WorkspaceTextFileReadResult, { kind: "text" }>;

type EditorSession = {
  id: string;
  baseline: TextFileResult;
  version: number;
};

type UseTaskExecutionFileEditorInput = {
  selectedFile: TaskExecutionSelectedFile | null;
  readyResult: TextFileResult | null;
  onEditStateChange(editState: { isDirty: boolean; isSaving: boolean }): void;
};

export const useTaskExecutionFileEditor = ({
  selectedFile,
  readyResult,
  onEditStateChange,
}: UseTaskExecutionFileEditorInput) => {
  const queryClient = useQueryClient();
  const mutation = useMutation(workspaceTextFileWriteMutationOptions(queryClient));
  const [session, setSession] = useState<EditorSession | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const draftRef = useRef("");
  const saveInFlightRef = useRef(false);

  useLayoutEffect(() => {
    if (!selectedFile || !readyResult) return;
    const id = `${selectedFile.rootPath}:${selectedFile.relativePath}`;
    setSession((previous) => {
      if (!previous || previous.id !== id) {
        draftRef.current = readyResult.contents;
        setIsDirty(false);
        setSaveError(null);
        return { id, baseline: readyResult, version: 0 };
      }
      if (previous.baseline.revision === readyResult.revision || isDirty) return previous;
      draftRef.current = readyResult.contents;
      return { id, baseline: readyResult, version: previous.version + 1 };
    });
  }, [isDirty, readyResult, selectedFile]);

  const onItemEditChange = useCallback(
    (item: CodeViewItem<undefined>, file: FileContents) => {
      if (!session || item.id !== session.id) return;
      draftRef.current = file.contents;
      setIsDirty(file.contents !== session.baseline.contents);
      setSaveError(null);
    },
    [session],
  );

  const save = useCallback(async (): Promise<void> => {
    if (!session || !isDirty || saveInFlightRef.current) return;
    saveInFlightRef.current = true;
    setIsSaving(true);
    setSaveError(null);
    const baselineRevision = session.baseline.revision;
    const contentsToSave = draftRef.current;
    try {
      const saved: WorkspaceTextFileWriteResult = await mutation.mutateAsync({
        rootPath: session.baseline.rootPath,
        relativePath: session.baseline.relativePath,
        contents: contentsToSave,
        revision: baselineRevision,
      });
      const latestDraft = draftRef.current;
      const hasNewerDraft = latestDraft !== contentsToSave;
      setSession((current) => {
        if (
          !current ||
          current.id !== session.id ||
          current.baseline.revision !== baselineRevision
        ) {
          return current;
        }
        return {
          ...current,
          baseline: saved,
          version: hasNewerDraft ? current.version : current.version + 1,
        };
      });
      if (hasNewerDraft) {
        setIsDirty(latestDraft !== saved.contents);
      } else {
        draftRef.current = saved.contents;
        setIsDirty(false);
      }
    } catch (cause) {
      setSaveError(errorMessage(cause));
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
    }
  }, [isDirty, mutation, session]);

  useLayoutEffect(() => {
    onEditStateChange({ isDirty, isSaving });
  }, [isDirty, isSaving, onEditStateChange]);

  return useMemo(
    () => ({
      session,
      isDirty,
      isSaving,
      saveError,
      onItemEditChange,
      save,
    }),
    [isDirty, isSaving, onItemEditChange, save, saveError, session],
  );
};
