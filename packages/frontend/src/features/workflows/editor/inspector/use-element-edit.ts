import type { WorkflowProblemPath } from "@openducktor/contracts";
import type { ElementOf, ListElementKind } from "../model/document-elements";
import { updateElement } from "../model/document-edits";
import { fieldCoalesceKey, useInspector } from "./inspector-context";

/**
 * Edits one element of a definition list. `edit` makes one undo step. `editText` joins the
 * keystrokes of one field into one undo step.
 */
export const useElementEdit = <Kind extends ListElementKind>(kind: Kind, id: string) => {
  const { change, elementKey } = useInspector();
  return {
    edit: (update: (item: ElementOf<Kind>) => ElementOf<Kind>) =>
      change((document) => updateElement(document, kind, id, update)),
    editText: (path: WorkflowProblemPath, update: (item: ElementOf<Kind>) => ElementOf<Kind>) =>
      change((document) => updateElement(document, kind, id, update), {
        coalesceKey: fieldCoalesceKey(elementKey, path),
      }),
  };
};
