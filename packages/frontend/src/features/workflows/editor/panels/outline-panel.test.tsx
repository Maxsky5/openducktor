import { describe, expect, test } from "bun:test";
import type { WorkflowDocument } from "@openducktor/contracts";
import { builtinCompiledCatalogFixture } from "@openducktor/frontend-core/test-support/workflow-fixtures";
import { newWorkflowDocument } from "@openducktor/workflows";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { EditorContext, type EditorEnvironment } from "../editor-context";
import { addState } from "../model/create-elements";
import { updateDefinition } from "../model/document-edits";
import type { EditorCheckContext } from "../model/editor-derivation";
import { createViewOf } from "../use-editor-derivation";
import { createEditorStore, type EditorStore } from "../model/editor-store";
import { OutlinePanel } from "./outline-panel";

const CONTEXT: EditorCheckContext = {
  roles: builtinCompiledCatalogFixture.roles,
  otherWorkflows: [],
  takenWorkflowIds: new Set(),
  sharedStateIds: new Set(),
  sharedStates: new Map(),
};

/** Backlog, Done, Triage, Fixing in the list: Done is not last, as in an older document. */
const document = (): WorkflowDocument => {
  let value = newWorkflowDocument("flow", "Flow");
  value = addState(value, "Triage").document;
  value = addState(value, "Fixing").document;
  return updateDefinition(value, (definition) => {
    const [open, triage, fixing, closed] = definition.states;
    return { ...definition, states: [open!, closed!, triage!, fixing!] };
  });
};

function Harness({ store }: { store: EditorStore }): ReactElement {
  const environment: EditorEnvironment = {
    store,
    viewOf: createViewOf(CONTEXT, true),
    catalogRoles: [],
    roles: { newRole: () => {}, editRole: () => {}, duplicateRole: () => {} },
    published: false,
    takenWorkflowIds: new Set(),
    sharedStates: new Map(),
  };
  return (
    <EditorContext value={environment}>
      <TooltipProvider>
        <OutlinePanel />
      </TooltipProvider>
    </EditorContext>
  );
}

const stateRows = () => {
  const group = screen.getByRole("region", { name: "States" });
  return within(group)
    .getAllByRole("listitem")
    .map((row) => within(row).getAllByRole("button")[0]!.textContent);
};

describe("outline", () => {
  test("lists Backlog first and Done last, as the board does, without their move buttons", () => {
    const store = createEditorStore(
      {
        workflowId: "flow",
        document: document(),
        readOnly: false,
        hasDraft: true,
        viewPositions: {},
      },
      { saveDraft: async (workflowId) => ({ workflowId }) },
    );
    render(<Harness store={store} />);
    expect(stateRows()).toEqual(["Backlog", "Triage", "Fixing", "Done"]);
    expect(screen.queryByRole("button", { name: "Move Backlog down" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Move Done up" })).toBeNull();
    expect(screen.getByRole("button", { name: "Move Triage up" }).hasAttribute("disabled")).toBe(
      true,
    );

    const moveDown = screen.getByRole("button", { name: "Move Triage down" });
    moveDown.focus();
    fireEvent.click(moveDown);
    expect(stateRows()).toEqual(["Backlog", "Fixing", "Triage", "Done"]);
    // The last movable row turns its Move down off, so the focus goes to its Move up.
    expect(globalThis.document.activeElement?.getAttribute("aria-label")).toBe("Move Triage up");
    expect(store.getState().document.definition.states.map(({ id }) => id)).toEqual([
      "open",
      "closed",
      "fixing",
      "triage",
    ]);
  });

  test("names each section and offers its add command, and an empty section folds", () => {
    const store = createEditorStore(
      {
        workflowId: "flow",
        document: document(),
        readOnly: false,
        hasDraft: true,
        viewPositions: {},
      },
      { saveDraft: async (workflowId) => ({ workflowId }) },
    );
    render(<Harness store={store} />);
    const transitions = screen.getByRole("region", { name: "Transitions" });
    expect(within(transitions).getAllByRole("button", { name: "Add a transition" })).toHaveLength(
      1,
    );
    // Opened, the empty section offers its first element as a link too.
    fireEvent.click(within(transitions).getByRole("button", { name: /^Transitions/ }));
    expect(within(transitions).getAllByRole("button", { name: "Add a transition" })).toHaveLength(
      2,
    );
    expect(
      within(screen.getByRole("region", { name: "States" })).getByRole("button", {
        name: "Add a state",
      }),
    ).toBeTruthy();
  });

  test("a search finds elements inside Advanced, and says when nothing matches", () => {
    const store = createEditorStore(
      {
        workflowId: "flow",
        document: document(),
        readOnly: false,
        hasDraft: true,
        viewPositions: {},
      },
      { saveDraft: async (workflowId) => ({ workflowId }) },
    );
    render(<Harness store={store} />);
    const search = screen.getByRole("textbox", { name: "Find an element" });
    fireEvent.change(search, { target: { value: "Launch order" } });
    expect(screen.getByRole("button", { name: /^Launch order/ })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "States" })).toBeNull();
    fireEvent.change(search, { target: { value: "nothing like this" } });
    expect(screen.getByText("No element matches “nothing like this”.")).toBeTruthy();
  });

  test("adds a step with its kind from the add form", () => {
    const store = createEditorStore(
      {
        workflowId: "flow",
        document: document(),
        readOnly: false,
        hasDraft: true,
        viewPositions: {},
      },
      { saveDraft: async (workflowId) => ({ workflowId }) },
    );
    render(<Harness store={store} />);
    const steps = screen.getByRole("region", { name: "Steps" });
    fireEvent.click(within(steps).getAllByRole("button", { name: "Add a step" })[0]!);
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Review" } });
    fireEvent.click(screen.getByRole("radio", { name: /Person/ }));
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    const step = store.getState().document.definition.steps[0];
    expect(step?.label).toBe("Review");
    expect(step?.kind).toBe("human");
  });
});
