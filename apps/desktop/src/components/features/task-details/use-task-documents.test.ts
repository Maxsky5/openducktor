import { describe, expect, test } from "bun:test";
import { resolveLoadedDocumentState, type TaskDocumentPayload } from "./task-document-state";
import type { TaskDocumentState } from "./use-task-documents";

const createDocumentState = (overrides: Partial<TaskDocumentState> = {}): TaskDocumentState => ({
  markdown: "",
  updatedAt: null,
  isLoading: true,
  error: "stale error",
  loaded: false,
  ...overrides,
});

const createDocumentPayload = (
  overrides: Partial<TaskDocumentPayload> = {},
): TaskDocumentPayload => ({
  markdown: "",
  updatedAt: null,
  ...overrides,
});

describe("resolveLoadedDocumentState", () => {
  test("preserves the current document when an older payload resolves", () => {
    const current = createDocumentState({
      markdown: "# Updated spec",
      updatedAt: "2026-02-22T09:00:00.000Z",
      isLoading: true,
      error: "temporary",
      loaded: true,
    });

    const resolved = resolveLoadedDocumentState(current, createDocumentPayload());

    expect(resolved).toEqual({
      markdown: "# Updated spec",
      updatedAt: "2026-02-22T09:00:00.000Z",
      isLoading: false,
      error: null,
      loaded: true,
    });
  });

  test("applies the incoming payload when it is newer than the current document", () => {
    const current = createDocumentState({
      markdown: "# Old spec",
      updatedAt: "2026-02-22T09:00:00.000Z",
      isLoading: true,
      loaded: true,
    });

    const resolved = resolveLoadedDocumentState(
      current,
      createDocumentPayload({
        markdown: "# Server spec",
        updatedAt: "2026-02-22T09:15:00.000Z",
      }),
    );

    expect(resolved).toEqual({
      markdown: "# Server spec",
      updatedAt: "2026-02-22T09:15:00.000Z",
      isLoading: false,
      error: null,
      loaded: true,
    });
  });
});
