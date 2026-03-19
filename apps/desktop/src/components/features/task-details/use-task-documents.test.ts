import { describe, expect, test } from "bun:test";
import type { TaskDocumentPayload } from "@/types/task-documents";
import { resolveLoadedDocumentState } from "./task-document-state";
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
  test("applies the incoming payload when the incoming document has no timestamp", () => {
    const current = createDocumentState({
      markdown: "# Updated spec",
      updatedAt: "2026-02-22T09:00:00.000Z",
      isLoading: true,
      error: "temporary",
      loaded: true,
    });

    const resolved = resolveLoadedDocumentState(
      current,
      createDocumentPayload({
        markdown: "# Server spec without timestamp",
        updatedAt: null,
      }),
    );

    expect(resolved).toEqual({
      markdown: "# Server spec without timestamp",
      updatedAt: null,
      isLoading: false,
      error: null,
      loaded: true,
    });
  });

  test("preserves the current document when the incoming timestamp is older", () => {
    const current = createDocumentState({
      markdown: "# Updated spec",
      updatedAt: "2026-02-22T09:00:00.000Z",
      isLoading: true,
      error: "temporary",
      loaded: true,
    });

    const resolved = resolveLoadedDocumentState(
      current,
      createDocumentPayload({
        markdown: "# Older server spec",
        updatedAt: "2026-02-22T08:45:00.000Z",
      }),
    );

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

  test("applies the incoming payload when neither document has a timestamp", () => {
    const current = createDocumentState({
      markdown: "# Loaded spec",
      updatedAt: null,
      isLoading: true,
      loaded: true,
    });

    const resolved = resolveLoadedDocumentState(
      current,
      createDocumentPayload({ markdown: "# Incoming spec" }),
    );

    expect(resolved).toEqual({
      markdown: "# Incoming spec",
      updatedAt: null,
      isLoading: false,
      error: null,
      loaded: true,
    });
  });
});
