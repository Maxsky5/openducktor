import { beforeEach, describe, expect, test } from "bun:test";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import type { StoreApi } from "zustand";
import {
  type BrowserAnnotationStore,
  browserAnnotationStoreOf,
  toBrowserAnnotationOwnerKey,
} from "./browser-annotation-store";
import type { BrowserAnnotationOwner } from "./browser-annotation-types";
import { buildCapture } from "./browser-annotation-test-support";

const OWNER: BrowserAnnotationOwner = {
  kind: "task",
  workspaceId: "workspace-1",
  taskId: "task-1",
};
const OTHER_OWNER: BrowserAnnotationOwner = {
  kind: "workspace_session",
  workspaceId: "workspace-1",
  sessionId: "task-1",
};

const keyOf = (owner: BrowserAnnotationOwner): string => {
  const key = toBrowserAnnotationOwnerKey(owner);
  if (key === null) throw new Error("Expected an owner key");
  return key;
};
const OWNER_KEY = keyOf(OWNER);
const OTHER_KEY = keyOf(OTHER_OWNER);

let annotationStore: StoreApi<BrowserAnnotationStore>;
const store = () => annotationStore.getState();
const add = (ownerKey: string, comment: string) =>
  store().addAnnotation(ownerKey, { capture: buildCapture(), comment, includeScreenshot: true });
const annotationsOf = (ownerKey: string) => store().annotationsByOwner[ownerKey] ?? [];
const pendingCount = (ownerKey: string): number => store().getPendingAnnotations(ownerKey).length;

describe("browser annotation store", () => {
  beforeEach(() => {
    annotationStore = browserAnnotationStoreOf(createTestClientConnection());
  });

  test("numbers each owner from one and continues after the highest number", () => {
    const first = add(OWNER_KEY, "  First comment\nsecond line  ");
    const second = add(OWNER_KEY, "Second");
    const third = add(OWNER_KEY, "Third");
    store().removeAnnotation(OWNER_KEY, second.id);

    expect(first).toMatchObject({ number: 1, comment: "First comment\nsecond line" });
    expect(add(OWNER_KEY, "Fourth").number).toBe(4);
    expect(add(OTHER_KEY, "Other owner").number).toBe(1);
    store().removeAnnotation(OWNER_KEY, third.id);
    expect(annotationsOf(OWNER_KEY).map((annotation) => annotation.number)).toEqual([1, 4]);
    expect(pendingCount(OWNER_KEY)).toBe(2);
  });

  test("keeps the capture data, the comment, and the screenshot choice", () => {
    const capture = buildCapture({ selectedText: "Save" });
    const annotation = store().addAnnotation(OWNER_KEY, {
      capture,
      comment: "No screenshot",
      includeScreenshot: false,
    });

    expect(annotation).toMatchObject({
      includeScreenshot: false,
      page: capture.page,
      selectedText: "Save",
      elements: capture.elements,
      image: capture.image,
      status: "pending",
    });
  });

  test("rejects a blank comment when it adds or edits an annotation", () => {
    expect(() => add(OWNER_KEY, " \n ")).toThrow("Browser annotations need a comment.");
    const annotation = add(OWNER_KEY, "Comment");
    expect(() =>
      store().updateAnnotation(OWNER_KEY, annotation.id, {
        comment: "  ",
        includeScreenshot: true,
      }),
    ).toThrow("Browser annotations need a comment.");
  });

  test("locks a sent batch, restores it on rejection, and clears it once on acceptance", () => {
    const first = add(OWNER_KEY, "First");
    const second = add(OWNER_KEY, "Second");
    const snapshots = store()
      .getPendingAnnotations(OWNER_KEY)
      .map(({ id, revision }) => ({ id, revision }));

    const rejected = store().beginSubmittingAnnotations(OWNER_KEY, snapshots);
    if (!rejected) throw new Error("Expected a submission");
    expect(pendingCount(OWNER_KEY)).toBe(0);
    for (const action of [
      () =>
        store().updateAnnotation(OWNER_KEY, first.id, { comment: "Edit", includeScreenshot: true }),
      () => store().removeAnnotation(OWNER_KEY, first.id),
    ]) {
      expect(action).toThrow("while it is being sent");
    }
    const newer = add(OWNER_KEY, "Added while sending");
    expect(newer.number).toBe(3);

    store().restoreSubmittingAnnotations(rejected);
    expect(pendingCount(OWNER_KEY)).toBe(3);

    const accepted = store().beginSubmittingAnnotations(OWNER_KEY, snapshots);
    if (!accepted) throw new Error("Expected a submission");
    add(OWNER_KEY, "Added after send");
    store().completeSubmittingAnnotations(accepted);
    store().completeSubmittingAnnotations(accepted);

    expect(annotationsOf(OWNER_KEY).map((entry) => entry.comment)).toEqual([
      "Added while sending",
      "Added after send",
    ]);
    expect(annotationsOf(OWNER_KEY).some((entry) => entry.id === second.id)).toBe(false);
  });

  test("does not send an annotation that changed after its snapshot", () => {
    const annotation = add(OWNER_KEY, "Before");
    const snapshot = { id: annotation.id, revision: annotation.revision };
    store().updateAnnotation(OWNER_KEY, annotation.id, {
      comment: "After",
      includeScreenshot: false,
    });

    expect(store().beginSubmittingAnnotations(OWNER_KEY, [snapshot])).toBeNull();
    expect(store().getPendingAnnotations(OWNER_KEY)[0]).toMatchObject({
      comment: "After",
      includeScreenshot: false,
      status: "pending",
    });
  });

  test("removes all annotations of an owner and keeps the other owners", () => {
    add(OWNER_KEY, "First");
    add(OWNER_KEY, "Second");
    add(OTHER_KEY, "Other owner");

    store().removeOwner(OWNER);

    expect(store().annotationsByOwner[OWNER_KEY]).toBeUndefined();
    expect(pendingCount(OTHER_KEY)).toBe(1);
  });

  test("builds no owner key for an incomplete owner", () => {
    expect(toBrowserAnnotationOwnerKey(null)).toBeNull();
    expect(toBrowserAnnotationOwnerKey({ ...OWNER, workspaceId: " " })).toBeNull();
    expect(toBrowserAnnotationOwnerKey({ ...OWNER, taskId: "" })).toBeNull();
    expect(OWNER_KEY).not.toBe(OTHER_KEY);
  });
});
