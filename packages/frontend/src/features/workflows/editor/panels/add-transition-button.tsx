import type { WorkflowElementKey } from "@openducktor/workflows";
import type { ReactElement } from "react";
import { useEditor } from "../editor-context";
import { addEvent } from "../model/create-elements";
import { AddTrigger } from "./new-element-button";

/**
 * Adds a transition from a state at once, with no name to type: a transition is named by its
 * triggers. The details then focus its target.
 */
export function AddTransitionButton({
  from,
  label,
  variant,
}: {
  /** The source state. Without it, the first state of the workflow. */
  from?: string;
  label: string;
  variant: "icon" | "link";
}): ReactElement {
  const { store } = useEditor();
  const add = () => {
    let created: WorkflowElementKey | null = null;
    store.getState().create((current) => {
      const result = addEvent(current, from ?? current.definition.states[0]?.id ?? "open", null);
      created = result.key;
      return result;
    });
    if (created !== null) store.getState().select(created, ["outcomes", 0, "to"]);
  };
  return <AddTrigger label={label} variant={variant} onClick={add} />;
}
