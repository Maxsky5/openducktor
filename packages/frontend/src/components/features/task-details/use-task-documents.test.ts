import { describe, expect, mock, test } from "bun:test";
import { QueryClient, queryOptions } from "@tanstack/react-query";
import { resolveLatestDocumentPayload } from "@/state/queries/document-utils";
import { documentQueryKeys } from "@/state/queries/documents";
import type { TaskDocumentPayload } from "@/types/task-documents";
import { ensureTaskDocumentQueryData } from "./task-document-query-data";
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

const waitForCachedPlanMarkdown = async (
  queryClient: QueryClient,
  expectedMarkdown: string,
): Promise<void> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < 1000) {
    const document = queryClient.getQueryData<TaskDocumentPayload>(
      documentQueryKeys.plan("/repo", "task-1"),
    );

    if (document?.markdown === expectedMarkdown) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Expected cached plan markdown to be ${expectedMarkdown}`);
};

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

  test("preserves the current document and its error when the incoming timestamp is older", () => {
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
      error: "temporary",
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

  test("preserves document-level payload errors on the loaded state", () => {
    const current = createDocumentState({
      markdown: "# Previous spec",
      updatedAt: "2026-02-22T09:00:00.000Z",
      isLoading: true,
      loaded: true,
    });

    const resolved = resolveLoadedDocumentState(
      current,
      createDocumentPayload({
        markdown: "",
        updatedAt: "2026-02-22T09:15:00.000Z",
        error: "Failed to decode openducktor.documents.spec[0]: invalid base64 payload",
      }),
    );

    expect(resolved).toEqual({
      markdown: "",
      updatedAt: "2026-02-22T09:15:00.000Z",
      isLoading: false,
      error: "Failed to decode openducktor.documents.spec[0]: invalid base64 payload",
      loaded: true,
    });
  });
});

describe("useTaskDocuments", () => {
  test("document query ensure revalidates stale cached documents on demand", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });
    queryClient.setQueryData(documentQueryKeys.plan("/repo", "task-1"), {
      markdown: "# Cached plan",
      updatedAt: "2026-05-07T20:00:00.000Z",
    });

    const loadPlanDocument = mock(async (): Promise<TaskDocumentPayload> => {
      return {
        markdown: "# Fresh plan",
        updatedAt: "2026-05-07T20:05:00.000Z",
      };
    });

    try {
      await queryClient.invalidateQueries({
        queryKey: documentQueryKeys.plan("/repo", "task-1"),
        exact: true,
        refetchType: "none",
      });
      loadPlanDocument.mockClear();

      const options = queryOptions({
        queryKey: documentQueryKeys.plan("/repo", "task-1"),
        queryFn: async (): Promise<TaskDocumentPayload> => {
          const incoming = await loadPlanDocument();
          const current = queryClient.getQueryData<TaskDocumentPayload>(
            documentQueryKeys.plan("/repo", "task-1"),
          );
          return resolveLatestDocumentPayload(current, incoming);
        },
      });

      await ensureTaskDocumentQueryData(queryClient, options);
      await waitForCachedPlanMarkdown(queryClient, "# Fresh plan");

      expect(loadPlanDocument).toHaveBeenCalledTimes(1);
      expect(
        queryClient.getQueryData<TaskDocumentPayload>(documentQueryKeys.plan("/repo", "task-1")),
      ).toEqual({
        markdown: "# Fresh plan",
        updatedAt: "2026-05-07T20:05:00.000Z",
      });
    } finally {
      queryClient.clear();
    }
  });
});
