import { describe, expect, test } from "bun:test";
import {
  clearTaskExecutionFilePreviewState,
  createTaskExecutionFilePreviewState,
  discardTaskExecutionFilePreviewDraft,
  keepEditingTaskExecutionFilePreview,
  reportTaskExecutionFilePreviewEditState,
  requestTaskExecutionFilePreviewIntent,
} from "./task-execution-file-preview-state";

const firstFile = { rootPath: "/repo", relativePath: "first.ts" };
const secondFile = { rootPath: "/repo", relativePath: "second.ts" };

describe("task execution file preview state", () => {
  test("opens and switches clean files at once", () => {
    const opened = requestTaskExecutionFilePreviewIntent(createTaskExecutionFilePreviewState(), {
      type: "select",
      file: firstFile,
    });
    const switched = requestTaskExecutionFilePreviewIntent(opened, {
      type: "select",
      file: secondFile,
    });

    expect(opened).toMatchObject({ selectedFile: firstFile, previewSessionKey: 1 });
    expect(switched).toMatchObject({
      selectedFile: secondFile,
      previewSessionKey: 1,
      preservePreviousSnapshot: true,
    });
  });

  test("holds one dirty navigation intent until the user decides", () => {
    const opened = requestTaskExecutionFilePreviewIntent(createTaskExecutionFilePreviewState(), {
      type: "select",
      file: firstFile,
    });
    const dirty = reportTaskExecutionFilePreviewEditState(opened, {
      isDirty: true,
      isSaving: false,
    });
    const pending = requestTaskExecutionFilePreviewIntent(dirty, {
      type: "select",
      file: secondFile,
    });
    const ignoredClose = requestTaskExecutionFilePreviewIntent(pending, { type: "close" });

    expect(pending.selectedFile).toEqual(firstFile);
    expect(pending.pendingIntent).toEqual({ type: "select", file: secondFile });
    expect(ignoredClose).toBe(pending);
    expect(keepEditingTaskExecutionFilePreview(pending)).toMatchObject({
      selectedFile: firstFile,
      isDirty: true,
      pendingIntent: null,
    });
    expect(discardTaskExecutionFilePreviewDraft(pending)).toMatchObject({
      selectedFile: secondFile,
      isDirty: false,
      pendingIntent: null,
    });
  });

  test("ignores close and switch requests while saving", () => {
    const opened = requestTaskExecutionFilePreviewIntent(createTaskExecutionFilePreviewState(), {
      type: "select",
      file: firstFile,
    });
    const saving = reportTaskExecutionFilePreviewEditState(opened, {
      isDirty: true,
      isSaving: true,
    });

    expect(requestTaskExecutionFilePreviewIntent(saving, { type: "close" })).toBe(saving);
    expect(
      requestTaskExecutionFilePreviewIntent(saving, { type: "select", file: secondFile }),
    ).toBe(saving);
  });

  test("holds a context transition while dirty and defers it while saving", () => {
    const opened = requestTaskExecutionFilePreviewIntent(createTaskExecutionFilePreviewState(), {
      type: "select",
      file: firstFile,
    });
    const dirty = reportTaskExecutionFilePreviewEditState(opened, {
      isDirty: true,
      isSaving: false,
    });
    const pending = requestTaskExecutionFilePreviewIntent(dirty, { type: "leave_context" });
    const saving = reportTaskExecutionFilePreviewEditState(dirty, {
      isDirty: true,
      isSaving: true,
    });

    expect(pending).toMatchObject({
      selectedFile: firstFile,
      isDirty: true,
      pendingIntent: { type: "leave_context" },
    });
    expect(requestTaskExecutionFilePreviewIntent(saving, { type: "leave_context" })).toMatchObject({
      selectedFile: firstFile,
      isSaving: true,
      pendingIntent: { type: "leave_context" },
    });
    expect(clearTaskExecutionFilePreviewState(saving)).toBe(saving);
  });
});
