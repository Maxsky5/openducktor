import type { WorkflowLibrary } from "@openducktor/contracts";
import { errorMessage } from "@openducktor/frontend-core/lib/errors";
import type { CompiledWorkflowCatalog } from "@openducktor/workflows";
import { useMemo } from "react";
import { useStore } from "zustand";
import {
  deriveEditorView,
  type EditorCheckContext,
  type EditorView,
  editorCheckContext,
} from "./model/editor-derivation";
import type { EditorState, EditorStore } from "./model/editor-store";

export type EditorDerivation =
  | {
      readonly context: EditorCheckContext;
      readonly viewOf: (state: EditorState) => EditorView;
      readonly error: null;
    }
  | { readonly context: null; readonly viewOf: null; readonly error: string };

/**
 * The derivation of the editor store snapshots, which derives each document once. Host problems
 * from a failed publication replace the live problems of the same document.
 */
export const createViewOf = (
  context: EditorCheckContext,
  check: boolean,
): ((state: EditorState) => EditorView) => {
  let last: {
    readonly document: EditorState["document"];
    readonly hostProblems: EditorState["hostProblems"];
    readonly view: EditorView;
  } | null = null;
  return ({ document, hostProblems }) => {
    if (last?.document === document && last.hostProblems === hostProblems) return last.view;
    const view = deriveEditorView(document, context, {
      check,
      hostProblems: hostProblems?.document === document ? hostProblems.problems : null,
    });
    last = { document, hostProblems, view };
    return view;
  };
};

/**
 * The check context from the catalog and library, and a derivation of the store snapshots that
 * derives each document once. A context that cannot start, such as a catalog that lacks a
 * library version, gives the error. The editor does not subscribe to the document here, so a
 * keystroke renders only the panels whose slice of the view changes.
 */
export const useEditorDerivation = (
  store: EditorStore,
  catalog: CompiledWorkflowCatalog,
  library: WorkflowLibrary,
  published: boolean,
): EditorDerivation => {
  const workflowId = useStore(store, (state) => state.workflowId);
  const readOnly = useStore(store, (state) => state.readOnly);
  return useMemo((): EditorDerivation => {
    let context: EditorCheckContext;
    try {
      context = editorCheckContext(catalog, library, workflowId, { published, readOnly });
    } catch (cause) {
      return { context: null, viewOf: null, error: errorMessage(cause) };
    }
    return { context, viewOf: createViewOf(context, !readOnly), error: null };
  }, [catalog, library, workflowId, published, readOnly]);
};
