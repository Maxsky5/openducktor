import type { WorkflowDocument } from "@openducktor/contracts";
import { elementKey, parseElementKey, type WorkflowElementKey } from "@openducktor/workflows";
import { CircleMinus, type LucideIcon, Trash2 } from "lucide-react";
import type { ReactElement } from "react";
import {
  ConfirmDialog,
  type ConfirmImpactCopy,
  ConfirmSubject,
} from "@/components/features/confirm/confirm-dialog";
import { useEditor, useEditorState } from "./editor-context";
import { elementExists, elementKindLabel, elementName } from "./model/document-elements";
import { buttonsOfEvent, eventsOfState } from "./model/document-edits";

/** The names of what goes with a deleted element: the buttons of a transition, the transitions of a state. */
const goesWith = (
  document: WorkflowDocument,
  key: WorkflowElementKey,
  roleLabels: ReadonlyMap<string, string>,
): string[] => {
  const { kind, id } = parseElementKey(key);
  if (kind === "event")
    return buttonsOfEvent(document.definition, id).map((button) => button.label || button.id);
  if (kind !== "state") return [];
  return eventsOfState(document.definition, id).map((event) =>
    elementName(document, elementKey("event", event.id), roleLabels),
  );
};

/** What a remove changes and keeps: the role or the type stays outside the workflow. */
const REMOVE_IMPACT = {
  role: {
    changes: ["Remove the role from this workflow"],
    kept: ["The role itself. You can add it back with + in Roles."],
  },
  issueType: {
    changes: ["Remove the type from this workflow", "New tasks of this workflow cannot pick it"],
    kept: ["The built-in type. You can add it back with + in Issue types."],
  },
} as const;

const UNDO_NOTE = "You can undo it with ⌘Z.";

/** The text of the dialog for one element. */
type DeleteCopy = {
  readonly title: string;
  readonly description: string;
  readonly icon: LucideIcon;
  readonly subject: { readonly name: string; readonly id: string };
  readonly impact: ConfirmImpactCopy;
};

/** The text while no element waits for a confirmation. */
const CLOSED_COPY: DeleteCopy = {
  title: "",
  description: "",
  icon: Trash2,
  subject: { name: "", id: "" },
  impact: { changes: [], warning: UNDO_NOTE, undoable: true },
};

/** A role or an issue type goes out of the workflow with a remove. Other elements delete. */
const deleteCopy = (
  document: WorkflowDocument,
  key: WorkflowElementKey,
  roleLabels: ReadonlyMap<string, string>,
): DeleteCopy => {
  const { kind, id } = parseElementKey(key);
  const kindLabel = elementKindLabel(kind).toLowerCase();
  const subject = { name: elementName(document, key, roleLabels), id };
  if (kind === "role" || kind === "issueType")
    return {
      title: `Remove ${kindLabel}`,
      description: "Remove it from this workflow.",
      icon: CircleMinus,
      subject,
      impact: { ...REMOVE_IMPACT[kind], warning: UNDO_NOTE, undoable: true },
    };
  const extraKind = kind === "event" ? "button" : "transition";
  return {
    title: `Delete ${kindLabel}`,
    description: "Delete it from this workflow.",
    icon: Trash2,
    subject,
    impact: {
      changes: [
        `Delete the ${kindLabel}`,
        ...goesWith(document, key, roleLabels).map((extra) => `Delete its ${extraKind} “${extra}”`),
      ],
      warning: UNDO_NOTE,
      undoable: true,
    },
  };
};

/** Asks before an element goes, since its delete can break the elements that use it. */
export function DeleteElementDialog(): ReactElement {
  const { store, catalogRoles } = useEditor();
  const request = useEditorState((state) => state.deleteRequest);
  const document = useEditorState((state) => state.document);
  const key = request !== null && elementExists(document, request) ? request : null;
  const roleLabels = new Map(catalogRoles.map(({ role }) => [role.id, role.label]));
  const copy = key ? deleteCopy(document, key, roleLabels) : CLOSED_COPY;
  return (
    <ConfirmDialog
      open={key !== null}
      onOpenChange={(open) => !open && store.getState().requestRemove(null)}
      title={copy.title}
      description={copy.description}
      icon={copy.icon}
      subject={<ConfirmSubject name={copy.subject.name} id={copy.subject.id} />}
      impact={copy.impact}
      confirmLabel={copy.title}
      variant="destructive"
      pending={false}
      error={null}
      onConfirm={() => {
        if (!key) return;
        store.getState().requestRemove(null);
        store.getState().remove(key);
        // The deleted element took the focus with it, so the canvas takes it back.
        requestAnimationFrame(() =>
          globalThis.document.querySelector<HTMLElement>("[data-focus-panel]")?.focus(),
        );
      }}
    />
  );
}
