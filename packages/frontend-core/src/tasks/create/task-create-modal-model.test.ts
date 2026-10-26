import { describe, expect, test } from "bun:test";
import type { ComposerState } from "./task-composer-types";
import {
  hasUnsavedDocumentChanges,
  isDocumentNewerOnHost,
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
  labels: ["backend", "urgent"],
};

describe("task-create-modal-model", () => {
  test("detects document sections", () => {
    expect(isDocumentSection("spec")).toBe(true);
    expect(isDocumentSection("plan")).toBe(true);
    expect(isDocumentSection("details")).toBe(false);
  });

  test("builds create payload with normalized multi-line content", () => {
    expect(toTaskCreateInput(baseState)).toEqual({
      title: "Implement sync",
      issueType: "epic",
      aiReviewEnabled: true,
      priority: 2,
      description: "line one\n\nline two",
      labels: ["backend", "urgent"],
    });
  });

  test("does not include parent on create", () => {
    expect(toTaskCreateInput(baseState).parentId).toBeUndefined();
  });

  test("builds update patch without parent changes", () => {
    expect(toTaskUpdatePatch(baseState).parentId).toBeUndefined();
  });

  test("trims outer Markdown whitespace in create and update payloads", () => {
    const description = "  ---\r\ntitle: exact\r\n---\r\n\r\n-   item  \r\n  ";
    const state = { ...baseState, description };
    const expected = "---\r\ntitle: exact\r\n---\r\n\r\n-   item";

    expect(toTaskCreateInput(state).description).toBe(expected);
    expect(toTaskUpdatePatch(state).description).toBe(expected);
  });

  test("reports unsaved document changes by active section", () => {
    expect(hasUnsavedDocumentChanges("spec", { isSpecDirty: true, isPlanDirty: false })).toBe(true);
    expect(hasUnsavedDocumentChanges("plan", { isSpecDirty: true, isPlanDirty: false })).toBe(
      false,
    );
    expect(hasUnsavedDocumentChanges(null, { isSpecDirty: true, isPlanDirty: true })).toBe(false);
  });

  test("treats only a newer host document as a conflict", () => {
    const loaded = "2026-07-25T10:00:00.000Z";
    expect(isDocumentNewerOnHost(loaded, "2026-07-25T11:00:00.000Z")).toBe(true);
    expect(isDocumentNewerOnHost(null, loaded)).toBe(true);
    expect(isDocumentNewerOnHost(loaded, loaded)).toBe(false);
    expect(isDocumentNewerOnHost(loaded, "2026-07-25T09:00:00.000Z")).toBe(false);
    expect(isDocumentNewerOnHost(loaded, undefined)).toBe(false);
    expect(isDocumentNewerOnHost(null, undefined)).toBe(false);
  });
});
