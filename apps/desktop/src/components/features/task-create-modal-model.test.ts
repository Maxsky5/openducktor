import { describe, expect, test } from "bun:test";
import type { ComposerState } from "@/types/task-composer";
import {
  hasUnsavedDocumentChanges,
  isDocumentSection,
  toTaskCreateInput,
  toTaskUpdatePatch,
} from "./task-create-modal-model";

const baseState: ComposerState = {
  issueType: "epic",
  aiReviewEnabled: true,
  title: "  Implement sync  ",
  priority: 2,
  description: "line one\n\nline two",
  acceptanceCriteria: "a\n\n b ",
  labels: ["backend", "urgent"],
  parentId: "ep-1",
};

describe("task-create-modal-model", () => {
  test("detects document sections", () => {
    expect(isDocumentSection("spec")).toBe(true);
    expect(isDocumentSection("plan")).toBe(true);
    expect(isDocumentSection("details")).toBe(false);
  });

  test("builds create payload with normalized multi-line content", () => {
    expect(toTaskCreateInput(baseState, true)).toEqual({
      title: "Implement sync",
      issueType: "epic",
      aiReviewEnabled: true,
      priority: 2,
      description: "line one\n\nline two",
      acceptanceCriteria: "a\n\n b",
      labels: ["backend", "urgent"],
      parentId: "ep-1",
    });
  });

  test("drops parent on create when parent cannot be selected", () => {
    expect(toTaskCreateInput(baseState, false).parentId).toBeUndefined();
    expect(toTaskCreateInput({ ...baseState, parentId: "" }, true).parentId).toBeUndefined();
  });

  test("builds update patch and clears parent sentinel", () => {
    expect(toTaskUpdatePatch({ ...baseState, parentId: "__none__" }, true).parentId).toBe("");
    expect(toTaskUpdatePatch(baseState, false).parentId).toBe("");
  });

  test("reports unsaved document changes by active section", () => {
    expect(hasUnsavedDocumentChanges("spec", { isSpecDirty: true, isPlanDirty: false })).toBe(true);
    expect(hasUnsavedDocumentChanges("plan", { isSpecDirty: true, isPlanDirty: false })).toBe(
      false,
    );
    expect(hasUnsavedDocumentChanges(null, { isSpecDirty: true, isPlanDirty: true })).toBe(false);
  });
});
