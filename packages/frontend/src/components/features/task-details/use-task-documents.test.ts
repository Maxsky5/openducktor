import { describe, expect, mock, test } from "bun:test";
import { QueryClient, queryOptions } from "@tanstack/react-query";
import { resolveLatestDocumentPayload } from "@/state/queries/document-utils";
import { documentQueryKeys } from "@/state/queries/documents";
import type { TaskDocumentPayload } from "@/types/task-documents";
import { ensureTaskDocumentQueryData } from "./task-document-query-data";

const waitForCachedPlanMarkdown = async (
  queryClient: QueryClient,
  expectedMarkdown: string,
  startedAt = Date.now(),
  lastDocument?: TaskDocumentPayload,
): Promise<void> => {
  const document = queryClient.getQueryData<TaskDocumentPayload>(
    documentQueryKeys.plan("/repo", "task-1"),
  );
  if (document?.markdown === expectedMarkdown) {
    return;
  }

  if (Date.now() - startedAt >= 1000) {
    const actual = lastDocument ? lastDocument.markdown : JSON.stringify(lastDocument);
    throw new Error(`Expected cached plan markdown to be ${expectedMarkdown}, got ${actual}`);
  }

  await new Promise((resolve) => setTimeout(resolve, 10));
  await waitForCachedPlanMarkdown(queryClient, expectedMarkdown, startedAt, document);
};

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

      // ensureTaskDocumentQueryData returns cached stale data immediately; its
      // revalidation runs in the background, so waitForCachedPlanMarkdown waits for it to land.
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
