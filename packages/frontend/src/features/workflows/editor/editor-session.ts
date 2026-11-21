import type { WorkflowDocument, WorkflowDocumentView } from "@openducktor/contracts";
import { missingPositions } from "./model/canvas-layout";
import { createEditorStore, type EditorStore } from "./model/editor-store";

/** One open editor: the document read that seeded it, and its store. */
export type EditorSession = {
  /** Each seed starts a new session, so the editor view starts over. */
  readonly id: number;
  /** The workflow ID of the route. A rename of a draft-only workflow moves the route with it. */
  readonly routeId: string;
  /** The version of a read-only version route, else null. */
  readonly routeVersion: number | null;
  readonly seed: WorkflowDocumentView;
  readonly store: EditorStore;
};

let sessionCount = 0;

/**
 * Seeds an editor once from a document read. The built-in workflow and a version route are
 * read-only. A published workflow without a draft is editable: its first save creates the draft.
 * The opening layout places boxes without a saved position as view state, so opening saves
 * nothing.
 */
export const createEditorSession = (
  seed: WorkflowDocumentView,
  routeVersion: number | null,
  dependencies: {
    saveDraft: (workflowId: string, document: WorkflowDocument) => Promise<{ workflowId: string }>;
    onWorkflowIdChange: (workflowId: string) => void;
  },
): EditorSession => ({
  id: (sessionCount += 1),
  routeId: seed.workflowId,
  routeVersion,
  seed,
  store: createEditorStore(
    {
      workflowId: seed.workflowId,
      document: seed.document,
      readOnly: seed.source === "builtin" || routeVersion !== null,
      hasDraft: seed.kind === "draft",
      viewPositions: missingPositions(seed.document.definition, seed.document.layout),
    },
    dependencies,
  ),
});
