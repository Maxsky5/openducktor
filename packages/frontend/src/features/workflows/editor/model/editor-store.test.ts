import { describe, expect, test } from "bun:test";
import type { WorkflowDocument } from "@openducktor/contracts";
import { elementKey, newWorkflowDocument } from "@openducktor/workflows";
import { addEvent, addState } from "./create-elements";
import { deleteElement, updateElement } from "./document-edits";
import { AUTOSAVE_DELAY_MS } from "./draft-autosave";
import { createEditorStore, type EditorStoreDependencies } from "./editor-store";

type PendingSave = {
  document: WorkflowDocument;
  resolve: (workflowId?: string) => void;
  reject: (cause: Error) => void;
};

/** A host fake whose saves wait until the test settles them. */
const createSaveFake = () => {
  const saves: PendingSave[] = [];
  const saveDraft: EditorStoreDependencies["saveDraft"] = (workflowId, document) =>
    new Promise((resolve, reject) => {
      saves.push({
        document,
        resolve: (next = workflowId) => resolve({ workflowId: next }),
        reject,
      });
    });
  return { saves, saveDraft };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const seedDocument = (): WorkflowDocument => {
  const created = addState(newWorkflowDocument("flow", "Flow"), "Design review");
  return addEvent(created.document, "open", "design_review", "submit").document;
};

const createStore = (overrides: { readOnly?: boolean } = {}) => {
  const fake = createSaveFake();
  const store = createEditorStore(
    {
      workflowId: "flow",
      document: seedDocument(),
      readOnly: overrides.readOnly ?? false,
      hasDraft: true,
      viewPositions: {},
    },
    { saveDraft: fake.saveDraft },
  );
  return { store, saves: fake.saves };
};

const renameLabel = (document: WorkflowDocument, label: string) =>
  updateElement(document, "state", "design_review", (state) => ({ ...state, label }));

describe("editor store", () => {
  test("undo and redo restore each document snapshot, a delete included", () => {
    const { store } = createStore();
    const before = store.getState().document;
    store.getState().change((document) => deleteElement(document, elementKey("event", "submit")));
    expect(store.getState().document.definition.events).toHaveLength(0);

    store.getState().undo();
    expect(store.getState().document).toBe(before);
    expect(store.getState().future).toHaveLength(1);

    store.getState().redo();
    expect(store.getState().document.definition.events).toHaveLength(0);
    expect(store.getState().past).toHaveLength(1);
  });

  test("keystrokes of one field make one undo step", () => {
    const { store } = createStore();
    const before = store.getState().document;
    for (const label of ["D", "De", "Des"])
      store.getState().change((document) => renameLabel(document, label), { coalesceKey: "label" });
    expect(store.getState().past).toHaveLength(1);

    store.getState().change((document) => renameLabel(document, "Other"));
    expect(store.getState().past).toHaveLength(2);
    store.getState().undo();
    store.getState().undo();
    expect(store.getState().document).toBe(before);
  });

  test("a rename changes every reference and moves the selection", () => {
    const { store } = createStore();
    store.getState().select(elementKey("state", "design_review"));
    store.getState().rename("state", "design_review", "review");

    const { document, selection } = store.getState();
    expect(document.definition.states.map(({ id }) => id)).toContain("review");
    expect(document.definition.events[0]?.outcomes[0]?.to).toBe("review");
    expect(selection?.key).toBe(elementKey("state", "review"));

    store.getState().undo();
    expect(store.getState().document.definition.events[0]?.outcomes[0]?.to).toBe("design_review");
  });

  test("remove deletes an element in one undo step and clears its selection", () => {
    const { store } = createStore();
    const before = store.getState().document;
    store.getState().select(elementKey("state", "design_review"));
    store.getState().remove(elementKey("state", "design_review"));
    expect(store.getState().document.definition.states.map(({ id }) => id)).not.toContain(
      "design_review",
    );
    expect(store.getState().selection).toBeNull();

    store.getState().remove(elementKey("state", "open"));
    expect(store.getState().past).toHaveLength(1);

    store.getState().undo();
    expect(store.getState().document).toBe(before);
  });

  test("a read-only editor takes no change", () => {
    const { store, saves } = createStore({ readOnly: true });
    const before = store.getState().document;
    store.getState().change((document) => renameLabel(document, "Changed"));
    expect(store.getState().document).toBe(before);
    expect(saves).toHaveLength(0);
  });

  test("box positions stay in this session, so a move never changes or saves the workflow", () => {
    const { store, saves } = createStore();
    const before = store.getState().document;
    store.getState().setPositions({ open: { x: 10.4, y: 20.6 } });
    expect(store.getState().viewPositions.open).toEqual({ x: 10, y: 21 });
    expect(store.getState().document).toBe(before);
    expect(store.getState().past).toHaveLength(0);
    expect(store.getState().save).toEqual({ status: "saved" });
    store.getState().flushSave();
    expect(saves).toHaveLength(0);
  });

  test("a renamed state keeps its box", () => {
    const { store } = createStore();
    store.getState().setPositions({ design_review: { x: 40, y: 80 } });
    store.getState().rename("state", "design_review", "review");
    expect(store.getState().viewPositions.review).toEqual({ x: 40, y: 80 });
  });
});

describe("editor create", () => {
  test("adds an element in one undo step, selects it, and places its box for the session", () => {
    const fake = createSaveFake();
    const store = createEditorStore(
      {
        workflowId: "flow",
        document: newWorkflowDocument("flow", "Flow"),
        readOnly: false,
        hasDraft: false,
        viewPositions: { open: { x: 0, y: 0 }, closed: { x: 300, y: 0 } },
      },
      { saveDraft: fake.saveDraft },
    );
    store.getState().create((document) => addState(document, "Review"));

    const { document, selection, past } = store.getState();
    expect(selection?.key).toBe(elementKey("state", "review"));
    expect(past).toHaveLength(1);
    // The new state takes the place of Done, which moves one row down, and nothing is saved.
    const { viewPositions } = store.getState();
    expect(viewPositions.review).toEqual({ x: 300, y: 0 });
    expect(viewPositions.closed!.y).toBeGreaterThan(0);
    expect(viewPositions.open).toEqual({ x: 0, y: 0 });
    expect(document.layout.states).toEqual({});
  });
});

describe("editor hover", () => {
  test("keeps the hovered element apart from the selection and the undo history", () => {
    const { store } = createStore();
    store.getState().hover(elementKey("state", "design_review"));
    expect(store.getState().hoverKey).toBe(elementKey("state", "design_review"));
    expect(store.getState().selection).toBeNull();
    expect(store.getState().past).toHaveLength(0);
    store.getState().hover(null);
    expect(store.getState().hoverKey).toBeNull();
  });
});

describe("editor autosave", () => {
  test("shows Saving from the edit, saves after the pause, then shows Saved", async () => {
    const { store, saves } = createStore();
    store.getState().change((document) => renameLabel(document, "A"));
    expect(store.getState().save).toEqual({ status: "saving" });
    expect(saves).toHaveLength(0);
    await new Promise((resolve) => setTimeout(resolve, AUTOSAVE_DELAY_MS + 20));
    expect(saves).toHaveLength(1);

    saves[0]!.resolve();
    await flush();
    expect(store.getState().save).toEqual({ status: "saved" });
  });

  test("saves a run of edits once, with the newest document", () => {
    const { store, saves } = createStore();
    store.getState().change((document) => renameLabel(document, "A"));
    store.getState().change((document) => renameLabel(document, "B"));
    store.getState().flushSave();
    expect(saves).toHaveLength(1);
    expect(saves[0]!.document.definition.states[1]?.label).toBe("B");
  });

  test("runs one save at a time and saves only the newest queued document", async () => {
    const { store, saves } = createStore();
    store.getState().change((document) => renameLabel(document, "A"));
    store.getState().flushSave();
    store.getState().change((document) => renameLabel(document, "B"));
    store.getState().flushSave();
    store.getState().change((document) => renameLabel(document, "C"));
    store.getState().flushSave();
    expect(saves).toHaveLength(1);

    saves[0]!.resolve();
    await flush();
    expect(saves).toHaveLength(2);
    expect(saves[1]!.document.definition.states[1]?.label).toBe("C");
    expect(store.getState().save).toEqual({ status: "saving" });

    saves[1]!.resolve();
    await flush();
    expect(store.getState().save).toEqual({ status: "saved" });
  });

  test("save now starts the waiting save and resolves once the host has it", async () => {
    const { store, saves } = createStore();
    store.getState().change((document) => renameLabel(document, "A"));
    let done = false;
    const saved = store
      .getState()
      .saveNow()
      .then(() => (done = true));
    expect(saves).toHaveLength(1);
    await flush();
    expect(done).toBe(false);
    saves[0]!.resolve();
    await saved;
    expect(done).toBe(true);
  });

  test("save now rejects with the reason of a failed save", async () => {
    const { store, saves } = createStore();
    store.getState().change((document) => renameLabel(document, "A"));
    const saved = store.getState().saveNow();
    saves[0]!.reject(new Error("Host is offline."));
    expect(saved).rejects.toThrow("The draft did not save. Host is offline.");
  });

  test("a failed save keeps the document and Retry saves it again", async () => {
    const { store, saves } = createStore();
    store.getState().change((document) => renameLabel(document, "A"));
    store.getState().flushSave();
    saves[0]!.reject(new Error("Host is offline."));
    await flush();
    expect(store.getState().save).toEqual({ status: "failed", message: "Host is offline." });
    expect(store.getState().document.definition.states[1]?.label).toBe("A");

    store.getState().retrySave();
    expect(saves).toHaveLength(2);
    expect(saves[1]!.document).toBe(store.getState().document);
    saves[1]!.resolve();
    await flush();
    expect(store.getState().save).toEqual({ status: "saved" });
  });

  test("a change after a failed save saves the newest document", async () => {
    const { store, saves } = createStore();
    store.getState().change((document) => renameLabel(document, "A"));
    store.getState().flushSave();
    saves[0]!.reject(new Error("Host is offline."));
    await flush();

    store.getState().change((document) => renameLabel(document, "B"));
    expect(store.getState().save).toEqual({ status: "saving" });
    store.getState().flushSave();
    expect(saves).toHaveLength(2);
    expect(saves[1]!.document.definition.states[1]?.label).toBe("B");
  });

  test("undo saves the restored document", async () => {
    const { store, saves } = createStore();
    const before = store.getState().document;
    store.getState().change((document) => renameLabel(document, "A"));
    store.getState().flushSave();
    saves[0]!.resolve();
    await flush();

    store.getState().undo();
    store.getState().flushSave();
    expect(saves[1]!.document).toBe(before);
  });

  test("a save of a renamed draft-only workflow takes the new host ID", async () => {
    const fake = createSaveFake();
    const changes: string[] = [];
    const store = createEditorStore(
      {
        workflowId: "flow",
        document: seedDocument(),
        readOnly: false,
        hasDraft: true,
        viewPositions: {},
      },
      { saveDraft: fake.saveDraft, onWorkflowIdChange: (id) => changes.push(id) },
    );
    store.getState().change((document) => ({
      ...document,
      definition: { ...document.definition, id: "review-flow" },
    }));
    store.getState().flushSave();
    fake.saves[0]!.resolve("review-flow");
    await flush();
    expect(store.getState().workflowId).toBe("review-flow");
    expect(changes).toEqual(["review-flow"]);

    store.getState().change((document) => renameLabel(document, "A"));
    store.getState().flushSave();
    fake.saves[1]!.resolve();
    await flush();
    expect(changes).toEqual(["review-flow"]);
  });
});

describe("selection across undo and redo", () => {
  test("an undone rename selects the old ID, and redo selects the new one again", () => {
    const { store } = createStore();
    store.getState().select(elementKey("state", "design_review"));
    const instance = store.getState().selection?.instance;
    store.getState().rename("state", "design_review", "reviewing");
    store.getState().undo();
    expect(store.getState().selection?.key).toBe(elementKey("state", "design_review"));
    expect(store.getState().selection?.instance).toBe(instance);
    store.getState().redo();
    expect(store.getState().selection?.key).toBe(elementKey("state", "reviewing"));
  });

  test("an undone add closes the details of the element that is gone", () => {
    const { store } = createStore();
    store.getState().create((document) => addState(document, "Triage"));
    expect(store.getState().selection?.key).toBe(elementKey("state", "triage"));
    store.getState().undo();
    expect(store.getState().selection).toBeNull();
  });

  test("edits of one field after another element start a new undo step", () => {
    const { store } = createStore();
    const key = elementKey("state", "design_review");
    store.getState().select(key);
    store.getState().change((document) => renameLabel(document, "A"), { coalesceKey: "label" });
    store.getState().select(elementKey("state", "open"));
    store.getState().select(key);
    store.getState().change((document) => renameLabel(document, "B"), { coalesceKey: "label" });
    expect(store.getState().past).toHaveLength(2);
  });
});
