import { describe, expect, test } from "bun:test";
import type { WorkflowDocument } from "@openducktor/contracts";
import { builtinCompiledCatalogFixture } from "@openducktor/frontend-core/test-support/workflow-fixtures";
import { elementKey, newWorkflowDocument } from "@openducktor/workflows";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { EditorContext, type EditorEnvironment } from "../editor-context";
import { InspectorPanel } from "../inspector/inspector-panel";
import { addEvent } from "../model/create-elements";
import { updateElement } from "../model/document-edits";
import type { EditorCheckContext } from "../model/editor-derivation";
import { createViewOf } from "../use-editor-derivation";
import { createEditorStore, type EditorStore } from "../model/editor-store";
import { ProblemsPanel, readiness } from "./problems-panel";

const CONTEXT: EditorCheckContext = {
  roles: builtinCompiledCatalogFixture.roles,
  otherWorkflows: [],
  takenWorkflowIds: new Set(),
  sharedStateIds: new Set(),
  sharedStates: new Map(),
};

/** A draft with one event whose outcome names a state that does not exist. */
const brokenDocument = (): WorkflowDocument => {
  const document = addEvent(
    newWorkflowDocument("flow", "Flow"),
    "open",
    "closed",
    "finish",
  ).document;
  return updateElement(document, "event", "finish", (event) => ({
    ...event,
    outcomes: [{ when: true, to: "missing" }],
  }));
};

const createStore = (document: WorkflowDocument): EditorStore =>
  createEditorStore(
    { workflowId: "flow", document, readOnly: false, hasDraft: true, viewPositions: {} },
    { saveDraft: async (workflowId) => ({ workflowId }) },
  );

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
      <ProblemsPanel />
      <InspectorPanel />
    </EditorContext>
  );
}

/** A draft whose only problem is the warning about an event that nothing sends. */
const untriggeredDocument = (): WorkflowDocument =>
  addEvent(newWorkflowDocument("flow", "Flow"), "open", "closed", "finish").document;

const problemList = () => screen.getByRole("list", { name: "Problem list" });

describe("problems bar", () => {
  test("says Ready to publish without problems, the number to check with warnings, else counts errors", () => {
    const draft = (errorCount: number, warningCount: number) =>
      readiness({ errorCount, warningCount, hasDraft: true });
    expect(draft(0, 0)).toEqual({ level: null, title: "Ready to publish", detail: null });
    expect(draft(0, 2)).toEqual({
      level: "warning",
      title: "2 to check",
      detail: null,
    });
    expect(draft(3, 1)).toEqual({
      level: "error",
      title: "3 problems to fix",
      detail: "1 to check",
    });
    expect(draft(1, 0)).toEqual({
      level: "error",
      title: "1 problem to fix",
      detail: "Fix it to publish.",
    });
    expect(readiness({ errorCount: 0, warningCount: 0, hasDraft: false })).toEqual({
      level: null,
      title: "Published",
      detail: "Your next change starts a draft.",
    });
    expect(readiness({ errorCount: 0, warningCount: 1, hasDraft: false }).title).toBe("Published");
  });

  test("opens the list by itself while errors block publication", () => {
    const store = createStore(brokenDocument());
    render(<Harness store={store} />);
    const bar = screen.getByRole("button", { name: /problem to fix/ });
    expect(bar.getAttribute("aria-expanded")).toBe("true");
    expect(
      within(problemList()).getByRole("button", { name: /uses the missing state/ }),
    ).toBeTruthy();
  });

  test("keeps warnings closed until the user opens the list", () => {
    const store = createStore(untriggeredDocument());
    render(<Harness store={store} />);
    const bar = screen.getByRole("button", { name: /to check/ });
    expect(bar.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByRole("list", { name: "Problem list" })).toBeNull();
    fireEvent.click(bar);
    expect(bar.getAttribute("aria-expanded")).toBe("true");
    expect(within(problemList()).getByRole("button", { name: /Nothing triggers/ })).toBeTruthy();
  });

  test("a click on a problem selects its element and focuses the field at its path", async () => {
    const store = createStore(brokenDocument());
    const { container } = render(<Harness store={store} />);
    fireEvent.click(within(problemList()).getByRole("button", { name: /uses the missing state/ }));

    expect(store.getState().selection?.key).toBe(elementKey("event", "finish"));
    expect(store.getState().selection?.fieldPath).toEqual(["outcomes", 0, "to"]);
    await waitFor(() => {
      const field = container.querySelector('[data-field-path="outcomes[0].to"]');
      expect(field?.contains(document.activeElement)).toBe(true);
    });
  });

  test("the warning about an event that nothing sends focuses Add a button", async () => {
    const store = createStore(untriggeredDocument());
    render(<Harness store={store} />);
    fireEvent.click(screen.getByRole("button", { name: /to check/ }));
    fireEvent.click(within(problemList()).getByRole("button", { name: /Nothing triggers/ }));
    const add = await screen.findByRole("button", { name: "Add a button" });
    await waitFor(() => expect(document.activeElement).toBe(add));

    fireEvent.click(add);
    expect(store.getState().selection?.key).toBe(elementKey("event", "finish"));
    expect(store.getState().document.definition.actions).toEqual([
      {
        id: "move_to_done",
        label: "Move to Done",
        kind: "event",
        eventId: "finish",
        availableWhen: true,
      },
    ]);
    expect(screen.getByRole("button", { name: /^Move to Done/ })).toBeTruthy();
  });

  test("Add board button on a nothing-triggers row fixes the warning in one click", async () => {
    const store = createStore(untriggeredDocument());
    render(<Harness store={store} />);
    fireEvent.click(screen.getByRole("button", { name: /to check/ }));
    fireEvent.click(within(problemList()).getByRole("button", { name: "Add board button" }));

    expect(store.getState().selection?.key).toBe(elementKey("event", "finish"));
    expect(
      store
        .getState()
        .document.definition.actions.map((action) =>
          action.kind === "event" ? action.eventId : null,
        ),
    ).toEqual(["finish"]);
    await waitFor(() => expect(screen.getByText("Ready to publish")).toBeTruthy());
  });

  test("only a nothing-triggers row offers Add board button", () => {
    render(<Harness store={createStore(brokenDocument())} />);
    const errorRow = within(problemList())
      .getByRole("button", { name: /uses the missing state/ })
      .closest("li")!;
    expect(within(errorRow).queryByRole("button", { name: "Add board button" })).toBeNull();
    expect(within(problemList()).getAllByRole("button", { name: "Add board button" })).toHaveLength(
      1,
    );
  });

  test("the bar follows each change of the document", async () => {
    const store = createStore(brokenDocument());
    render(<Harness store={store} />);
    expect(screen.queryByText("Ready to publish")).toBeNull();
    act(() =>
      store.getState().change((document) =>
        updateElement(document, "event", "finish", (event) => ({
          ...event,
          outcomes: [{ when: true, to: "closed" }],
        })),
      ),
    );
    await waitFor(() => expect(screen.getByText(/to check/)).toBeTruthy());
  });
});
