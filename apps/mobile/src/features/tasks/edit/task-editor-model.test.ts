import { describe, expect, test } from "bun:test";
import { labelSuggestions, taskEditorSaveDisabled, withLabel } from "./task-editor-model";

describe("task editor labels", () => {
  test("adds a trimmed label once", () => {
    expect(withLabel(["api"], " ui ")).toEqual(["api", "ui"]);
    expect(withLabel(["needs-review"], "Needs Review")).toEqual(["needs-review"]);
    expect(withLabel([], "Needs  Review")).toEqual(["needs-review"]);
    expect(withLabel(["api"], "api")).toEqual(["api"]);
    expect(withLabel(["api"], "  ")).toEqual(["api"]);
  });

  test("suggests workspace labels that the task does not have", () => {
    expect(labelSuggestions(["api", "mobile", "ui"], ["api"], "")).toEqual(["mobile", "ui"]);
    expect(labelSuggestions(["api", "mobile", "ui"], [], "MOB")).toEqual(["mobile"]);
  });
});

describe("taskEditorSaveDisabled", () => {
  const task = {
    busy: false,
    locked: false,
    documentSection: false,
    title: "Add login",
    typeStep: false,
    conflict: false,
    destinationError: false,
    documentDirty: false,
    documentDraft: "",
  };

  test("saves a task with a title", () => {
    expect(taskEditorSaveDisabled(task)).toBe(false);
  });

  test("waits for a title, the type step, a conflict, and a destination error", () => {
    expect(taskEditorSaveDisabled({ ...task, title: "  " })).toBe(true);
    expect(taskEditorSaveDisabled({ ...task, typeStep: true })).toBe(true);
    expect(taskEditorSaveDisabled({ ...task, conflict: true })).toBe(true);
    expect(taskEditorSaveDisabled({ ...task, destinationError: true })).toBe(true);
  });

  test("waits while the editor is busy or locked", () => {
    expect(taskEditorSaveDisabled({ ...task, busy: true })).toBe(true);
    expect(taskEditorSaveDisabled({ ...task, locked: true })).toBe(true);
  });

  test("saves a document only with edited text", () => {
    const document = { ...task, documentSection: true, title: "" };
    expect(
      taskEditorSaveDisabled({ ...document, documentDirty: true, documentDraft: "# Plan" }),
    ).toBe(false);
    expect(
      taskEditorSaveDisabled({ ...document, documentDirty: false, documentDraft: "# Plan" }),
    ).toBe(true);
    expect(taskEditorSaveDisabled({ ...document, documentDirty: true, documentDraft: " " })).toBe(
      true,
    );
  });
});
