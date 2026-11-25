import { describe, expect, test } from "bun:test";
import { elementKey, newWorkflowDocument } from "@openducktor/workflows";
import { clearSelectionOnKey, deleteSelectedOnKey, deleteSelectionOnKey } from "./editor-keys";
import { addEvent, addState } from "./model/create-elements";
import { createEditorStore } from "./model/editor-store";

const DESIGN_REVIEW = elementKey("state", "design_review");
const SUBMIT = elementKey("event", "submit");

const createStore = (readOnly = false) => {
  const created = addState(newWorkflowDocument("flow", "Flow"), "Design review");
  const document = addEvent(created.document, "open", "design_review", "submit").document;
  return createEditorStore(
    { workflowId: "flow", document, readOnly, hasDraft: true, viewPositions: {} },
    { saveDraft: (workflowId) => Promise.resolve({ workflowId }) },
  );
};

/** The box of a state on the canvas, as React Flow renders it. */
const stateBox = (id: string): HTMLElement => {
  const box = document.createElement("div");
  box.className = "react-flow__node";
  box.dataset.id = id;
  return box;
};

/** The label button of a line on the canvas, with the transitions of the line. */
const lineLabel = (...eventIds: string[]): HTMLElement => {
  const label = document.createElement("button");
  label.dataset.eventIds = eventIds.join(" ");
  return label;
};

/** Presses a key on a focused element and tells whether the editor took it. */
const press = (
  store: ReturnType<typeof createStore>,
  key: string,
  target: HTMLElement = stateBox("design_review"),
): boolean => {
  let taken = false;
  deleteSelectionOnKey({ key, target, preventDefault: () => (taken = true) }, store);
  return taken;
};

const stateIds = (store: ReturnType<typeof createStore>) =>
  store.getState().document.definition.states.map(({ id }) => id);

describe("canvas delete keys", () => {
  test("Delete asks first, then removes the state in one undo step, and undo restores it", () => {
    const store = createStore();
    const before = store.getState().document;
    store.getState().select(DESIGN_REVIEW);

    expect(press(store, "Delete")).toBe(true);
    expect(stateIds(store)).toContain("design_review");
    expect(store.getState().deleteRequest).toBe(DESIGN_REVIEW);
    store.getState().remove(DESIGN_REVIEW);
    expect(stateIds(store)).not.toContain("design_review");
    expect(store.getState().selection).toBeNull();
    expect(store.getState().past).toHaveLength(1);

    store.getState().undo();
    expect(store.getState().document).toBe(before);
  });

  test("Backspace on a line label removes its transition, not another selection", () => {
    const store = createStore();
    store.getState().select(DESIGN_REVIEW);
    expect(press(store, "Backspace", lineLabel("other", "submit"))).toBe(false);

    expect(press(store, "Backspace", lineLabel("submit"))).toBe(true);
    expect(store.getState().deleteRequest).toBe(SUBMIT);
  });

  test("a text field keeps the keys", () => {
    const store = createStore();
    store.getState().select(DESIGN_REVIEW);

    expect(press(store, "Backspace", document.createElement("input"))).toBe(false);
    expect(press(store, "Delete", document.createElement("textarea"))).toBe(false);
    expect(stateIds(store)).toContain("design_review");
  });

  test("a read-only editor deletes nothing", () => {
    const store = createStore(true);
    store.getState().select(DESIGN_REVIEW);

    expect(press(store, "Delete")).toBe(false);
    expect(stateIds(store)).toContain("design_review");
    expect(store.getState().selection?.key).toBe(DESIGN_REVIEW);
  });

  test("other keys, other elements, and core states stay", () => {
    const store = createStore();
    store.getState().select(DESIGN_REVIEW);
    expect(press(store, "Enter")).toBe(false);

    press(store, "Delete", stateBox("open"));
    expect(stateIds(store)).toContain("open");
    expect(store.getState().past).toHaveLength(0);
  });

  test("the key acts on the focused box, and a canvas button deletes nothing", () => {
    const store = createStore();
    store.getState().select(SUBMIT);
    expect(press(store, "Delete", document.createElement("button"))).toBe(false);
    expect(store.getState().document.definition.events).toHaveLength(1);

    expect(press(store, "Delete", stateBox("design_review"))).toBe(true);
    expect(store.getState().deleteRequest).toBe(DESIGN_REVIEW);
  });
});

describe("editor delete keys", () => {
  /** A control inside the editor, such as the outline row of the selection. */
  const inEditor = (tag = "button"): HTMLElement => {
    const root = document.createElement("div");
    root.className = "workflow-editor";
    const control = document.createElement(tag);
    root.append(control);
    return control;
  };
  const pressIn = (store: ReturnType<typeof createStore>, key: string, target: HTMLElement) => {
    let taken = false;
    deleteSelectedOnKey({ key, target, preventDefault: () => (taken = true) }, store);
    return taken;
  };

  test("asks to delete the selection from any control of the editor", () => {
    const store = createStore();
    store.getState().select(SUBMIT);
    expect(pressIn(store, "Backspace", inEditor())).toBe(true);
    expect(store.getState().deleteRequest).toBe(SUBMIT);
  });

  test("leaves the keys to a text field, a core state, and the rest of the app", () => {
    const store = createStore();
    store.getState().select(SUBMIT);
    expect(pressIn(store, "Delete", inEditor("input"))).toBe(false);
    expect(pressIn(store, "Delete", document.createElement("button"))).toBe(false);
    store.getState().select(elementKey("state", "open"));
    expect(pressIn(store, "Delete", inEditor())).toBe(false);
    expect(store.getState().deleteRequest).toBeNull();
  });
});

describe("Escape", () => {
  test("clears the selection, so the details panel closes", () => {
    const store = createStore();
    store.getState().select(DESIGN_REVIEW);
    let taken = false;
    clearSelectionOnKey(
      {
        key: "Escape",
        target: document.createElement("div"),
        preventDefault: () => (taken = true),
      },
      store,
    );
    expect(taken).toBe(true);
    expect(store.getState().selection).toBeNull();
  });

  test("still closes the details while a toast or a tooltip shows", () => {
    const store = createStore();
    store.getState().select(DESIGN_REVIEW);
    const toast = document.createElement("li");
    toast.setAttribute("data-sonner-toast", "");
    toast.setAttribute("data-page-occluder", "");
    document.body.append(toast);
    clearSelectionOnKey(
      { key: "Escape", target: document.createElement("div"), preventDefault: () => {} },
      store,
    );
    toast.remove();
    expect(store.getState().selection).toBeNull();
  });

  test("leaves the selection while a text field has the focus", () => {
    const store = createStore();
    store.getState().select(DESIGN_REVIEW);
    clearSelectionOnKey(
      { key: "Escape", target: document.createElement("input"), preventDefault: () => {} },
      store,
    );
    expect(store.getState().selection?.key).toBe(DESIGN_REVIEW);
  });
});
