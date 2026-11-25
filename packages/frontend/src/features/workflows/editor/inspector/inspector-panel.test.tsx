import { describe, expect, test } from "bun:test";
import { type WorkflowDocument, workflowLibraryRoleSchema } from "@openducktor/contracts";
import { builtinCompiledCatalogFixture } from "@openducktor/frontend-core/test-support/workflow-fixtures";
import { elementKey, newWorkflowDocument, type WorkflowElementKey } from "@openducktor/workflows";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { EditorContext, type EditorEnvironment } from "../editor-context";
import { addAction, addEvent, addState } from "../model/create-elements";
import { updateElement, bindRole } from "../model/document-edits";
import type { EditorCheckContext } from "../model/editor-derivation";
import { createViewOf } from "../use-editor-derivation";
import { createEditorStore, type EditorStore } from "../model/editor-store";
import { InspectorPanel } from "./inspector-panel";

const CONTEXT: EditorCheckContext = {
  roles: builtinCompiledCatalogFixture.roles,
  otherWorkflows: [],
  takenWorkflowIds: new Set(),
  sharedStateIds: new Set(),
  sharedStates: new Map(),
};

function Harness({
  store,
  sharedStates,
}: {
  store: EditorStore;
  sharedStates: EditorEnvironment["sharedStates"];
}): ReactElement {
  const environment: EditorEnvironment = {
    store,
    viewOf: createViewOf(CONTEXT, true),
    catalogRoles: CONTEXT.roles.map((role) =>
      workflowLibraryRoleSchema.parse({ role, source: "builtin", workflowIds: [] }),
    ),
    roles: { newRole: () => {}, editRole: () => {}, duplicateRole: () => {} },
    published: false,
    takenWorkflowIds: new Set(),
    sharedStates,
  };
  return (
    <EditorContext value={environment}>
      <InspectorPanel />
    </EditorContext>
  );
}

const renderInspector = (
  document: WorkflowDocument,
  selection: WorkflowElementKey | null,
  readOnly = false,
  sharedStates: EditorEnvironment["sharedStates"] = new Map(),
) => {
  const store = createEditorStore(
    { workflowId: "flow", document, readOnly, hasDraft: true, viewPositions: {} },
    { saveDraft: async (workflowId) => ({ workflowId }) },
  );
  if (selection) act(() => store.getState().select(selection));
  render(<Harness store={store} sharedStates={sharedStates} />);
  return store;
};

/** A draft with one transition from Backlog to Done. */
const finishDocument = (): WorkflowDocument =>
  addEvent(newWorkflowDocument("flow", "Flow"), "open", "closed", "finish").document;

const disclosure = (title: string) => screen.getByRole("button", { name: new RegExp(`^${title}`) });

describe("transition inspector", () => {
  test("shows the route and the triggers first, and keeps Requirements and Advanced closed", () => {
    renderInspector(finishDocument(), elementKey("event", "finish"));
    expect(screen.getByText("From")).toBeTruthy();
    expect(screen.getByText("To")).toBeTruthy();
    expect(screen.getByText("Triggers")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a button" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pick an agent" })).toBeTruthy();
    expect(disclosure("Requirements").getAttribute("aria-expanded")).toBe("false");
    expect(disclosure("Advanced").getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByLabelText("ID")).toBeNull();
    fireEvent.click(disclosure("Requirements"));
    expect(screen.getByRole("button", { name: "Add a requirement" })).toBeTruthy();
  });

  test("turns on agents in the triggers and asks when to use it", () => {
    renderInspector(bindRole(finishDocument(), "build").document, elementKey("event", "finish"));
    fireEvent.click(screen.getByRole("switch", { name: "Agents" }));
    expect(screen.getByText("Which agents")).toBeTruthy();
    expect(screen.getByText("When to use it")).toBeTruthy();
    expect(screen.getByRole("switch", { name: "The agent must give a reason" })).toBeTruthy();
  });

  test("picks an agent of a workflow without roles, and adds its role to the workflow", () => {
    const store = renderInspector(finishDocument(), elementKey("event", "finish"));
    fireEvent.click(screen.getByRole("button", { name: "Pick an agent" }));
    fireEvent.click(screen.getByRole("option", { name: /Builder/ }));
    const { definition } = store.getState().document;
    expect(definition.roles.map(({ id }) => id)).toEqual(["build"]);
    expect(definition.events[0]?.agent?.roles).toEqual(["build"]);
    expect(screen.getByRole("switch", { name: "Agents" })).toBeTruthy();
  });

  test("adds a branch in the route, before the fallback that keeps its place", () => {
    renderInspector(finishDocument(), elementKey("event", "finish"));
    fireEvent.click(screen.getByRole("button", { name: "Branch on a condition" }));
    expect(screen.getByText("Branch 1")).toBeTruthy();
    expect(screen.getByText("Otherwise")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Move Branch 1 up" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Move Otherwise up" })).toBeNull();
  });

  test("turns on the reset with no role, picks a role, and keeps it across a switch off", () => {
    const store = renderInspector(
      bindRole(finishDocument(), "build").document,
      elementKey("event", "finish"),
    );
    fireEvent.click(screen.getByRole("switch", { name: "Reset the work" }));
    const effects = () => store.getState().document.definition.events[0]?.effects;
    expect(effects()).toEqual([{ id: "worktree.reset", clearsSessionsOf: [] }]);
    expect(screen.getByText(/No role is picked/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox", { name: "Builder" }));
    expect(effects()).toEqual([{ id: "worktree.reset", clearsSessionsOf: ["build"] }]);

    const toggle = () => fireEvent.click(screen.getByRole("switch", { name: "Reset the work" }));
    toggle();
    expect(effects()).toBeUndefined();
    toggle();
    expect(effects()).toEqual([{ id: "worktree.reset", clearsSessionsOf: ["build"] }]);
  });

  test("opens Requirements by itself when the transition has a requirement", () => {
    const document = updateElement(finishDocument(), "event", "finish", (event) => ({
      ...event,
      guards: [{ id: "ready", when: true }],
    }));
    renderInspector(document, elementKey("event", "finish"));
    expect(disclosure("Requirements").getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Requirement 1")).toBeTruthy();
  });
});

describe("list rows", () => {
  test("a removed row hands the focus to the next remove button, then to Add", () => {
    const document = updateElement(finishDocument(), "event", "finish", (event) => ({
      ...event,
      guards: [
        { id: "first", when: true },
        { id: "second", when: true },
      ],
    }));
    renderInspector(document, elementKey("event", "finish"));
    const removeFirst = screen.getByRole("button", { name: "Remove Requirement 1" });
    removeFirst.focus();
    fireEvent.click(removeFirst);
    expect(globalThis.document.activeElement?.getAttribute("aria-label")).toBe(
      "Remove Requirement 1",
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove Requirement 1" }));
    expect(globalThis.document.activeElement?.textContent).toBe("Add a requirement");
  });
});

describe("board button inspector", () => {
  test("uses plain labels for what the button does and where it shows", () => {
    const { document } = addAction(finishDocument(), "Finish", "event");
    renderInspector(document, elementKey("action", "finish"));
    expect(screen.getByText("What it does")).toBeTruthy();
    expect(screen.getByText("Move the task")).toBeTruthy();
    expect(screen.getAllByText("Show when").length).toBeGreaterThan(0);
    const showOn = screen.getByRole("group", { name: "Show on" });
    for (const surface of ["Board", "Task details", "Agent Studio", "Command palette"])
      expect(within(showOn).getByText(surface)).toBeTruthy();
    expect(screen.getByText(/No agent step exists yet/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add an agent step" })).toBeTruthy();
    expect(screen.queryByText("Available when")).toBeNull();
  });
});

describe("session button inspector", () => {
  test("says that the transition only shows the button and that the step moves the task", () => {
    const { document } = addAction(finishDocument(), "Start", "session");
    renderInspector(document, elementKey("action", "start"));
    expect(screen.getByText("Needs the transition")).toBeTruthy();
    expect(screen.getByText(/start transition of its agent step/)).toBeTruthy();
    expect(screen.queryByText("Moves with")).toBeNull();
  });
});

describe("workflow inspector", () => {
  test("names the first supported issue type and shows who can create the pull request", () => {
    const document = finishDocument();
    renderInspector(document, null);
    const first = document.definition.issueTypes[0]!;
    // Without a default, the new task form picks the first supported type.
    expect(screen.getAllByText(first.label).length).toBeGreaterThan(0);
    expect(screen.getByText("Every role")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add role" })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Workflow", level: 3 })).toBeNull();
  });

  test("lists the issue types in the built-in order", () => {
    const document = finishDocument();
    renderInspector(document, null);
    const group = screen.getByRole("group", { name: "Supported types" });
    const labels = within(group)
      .getAllByRole("checkbox")
      .map((checkbox) => checkbox.textContent);
    expect(labels).toEqual(["Feature", "Bug", "Task"]);
  });
});

describe("issue type inspector", () => {
  test("says the type is built in, and removes it from the workflow instead of deleting it", () => {
    renderInspector(finishDocument(), elementKey("issueType", "bug"));
    expect(
      screen.getByText("Built-in type: bug. You change only how this workflow shows it."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Remove from this workflow" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Delete / })).toBeNull();
  });
});

describe("read-only inspector", () => {
  test("offers no remove or move buttons", () => {
    renderInspector(finishDocument(), elementKey("event", "finish"), true);
    expect(screen.queryByRole("button", { name: /^Remove / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move .* up$/ })).toBeNull();
  });
});

describe("state inspector", () => {
  const triage = () => addState(newWorkflowDocument("flow", "Flow"), "Triage").document;
  const shared = new Map([["triage", { label: "Sorting", tone: "info" as const }]]);
  const stateIds = (store: EditorStore) =>
    store.getState().document.definition.states.map(({ id }) => id);

  test("a state that another workflow shows differently takes its look in one click", () => {
    const store = renderInspector(triage(), elementKey("state", "triage"), false, shared);
    expect(screen.getByText("Another workflow names this column “Sorting”.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Match it" }));
    const state = store.getState().document.definition.states.find(({ id }) => id === "triage");
    expect(state).toMatchObject({ label: "Sorting", tone: "info" });
    expect(screen.queryByText(/Another workflow names this column/)).toBeNull();
  });

  test("a state that another workflow shows differently can take its own ID", () => {
    const store = renderInspector(triage(), elementKey("state", "triage"), false, shared);
    fireEvent.click(screen.getByRole("button", { name: "Make it a separate state" }));
    expect(stateIds(store)).toEqual(["open", "triage_2", "closed"]);
    expect(store.getState().selection?.key).toBe(elementKey("state", "triage_2"));
  });
});
