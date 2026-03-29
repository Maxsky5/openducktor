import { afterEach, describe, expect, mock, test } from "bun:test";
import { createQueryClient } from "@/lib/query-client";
import { host } from "@/state/operations/host";
import {
  documentQueryKeys,
  fetchFreshTaskDocumentFromQuery,
  refreshCachedTaskDocumentQueries,
} from "./documents";

const createDocumentPayload = (markdown = "", updatedAt: string | null = null) => ({
  markdown,
  updatedAt,
});

describe("documents query helpers", () => {
  afterEach(() => {
    mock.restore();
  });

  test("fetchFreshTaskDocumentFromQuery performs an authoritative read and updates the cache", async () => {
    const queryClient = createQueryClient();
    const taskDocumentGet = mock(async () =>
      createDocumentPayload("# Spec V1", "2026-03-28T09:00:00.000Z"),
    );
    const taskDocumentGetFresh = mock(async () =>
      createDocumentPayload("# Spec V2", "2026-03-28T10:00:00.000Z"),
    );
    const original = {
      taskDocumentGet: host.taskDocumentGet,
      taskDocumentGetFresh: host.taskDocumentGetFresh,
    };
    host.taskDocumentGet = taskDocumentGet;
    host.taskDocumentGetFresh = taskDocumentGetFresh;

    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "# Spec V1",
      updatedAt: "2026-03-28T09:00:00.000Z",
    });

    try {
      const document = await fetchFreshTaskDocumentFromQuery(
        queryClient,
        "/repo",
        "task-1",
        "spec",
      );

      expect(document).toEqual({
        markdown: "# Spec V2",
        updatedAt: "2026-03-28T10:00:00.000Z",
      });
      expect(taskDocumentGet).not.toHaveBeenCalled();
      expect(taskDocumentGetFresh).toHaveBeenCalledWith("/repo", "task-1", "spec");
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
          documentQueryKeys.spec("/repo", "task-1"),
        ),
      ).toEqual({ markdown: "# Spec V2", updatedAt: "2026-03-28T10:00:00.000Z" });
    } finally {
      host.taskDocumentGet = original.taskDocumentGet;
      host.taskDocumentGetFresh = original.taskDocumentGetFresh;
      queryClient.clear();
    }
  });

  test("fetchFreshTaskDocumentFromQuery preserves newer optimistic content when the incoming payload is older", async () => {
    const queryClient = createQueryClient();
    const taskDocumentGetFresh = mock(async () =>
      createDocumentPayload("# Spec V1", "2026-03-28T09:00:00.000Z"),
    );
    const originalTaskDocumentGetFresh = host.taskDocumentGetFresh;
    host.taskDocumentGetFresh = taskDocumentGetFresh;

    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "# Optimistic spec",
      updatedAt: "2026-03-28T10:00:00.000Z",
    });

    try {
      const document = await fetchFreshTaskDocumentFromQuery(
        queryClient,
        "/repo",
        "task-1",
        "spec",
      );

      expect(document).toEqual({
        markdown: "# Optimistic spec",
        updatedAt: "2026-03-28T10:00:00.000Z",
      });
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
          documentQueryKeys.spec("/repo", "task-1"),
        ),
      ).toEqual({ markdown: "# Optimistic spec", updatedAt: "2026-03-28T10:00:00.000Z" });
    } finally {
      host.taskDocumentGetFresh = originalTaskDocumentGetFresh;
      queryClient.clear();
    }
  });

  test("refreshCachedTaskDocumentQueries force-refreshes only cached sections", async () => {
    const queryClient = createQueryClient();
    const taskDocumentGet = mock(async () =>
      createDocumentPayload("# Cached", "2026-03-28T09:00:00.000Z"),
    );
    const taskDocumentGetFresh = mock(
      async (_repoPath: string, _taskId: string, section: string) => {
        if (section === "plan") {
          return createDocumentPayload("# Plan V2", "2026-03-28T10:05:00.000Z");
        }
        return createDocumentPayload("# QA V2", "2026-03-28T10:10:00.000Z");
      },
    );
    const original = {
      taskDocumentGet: host.taskDocumentGet,
      taskDocumentGetFresh: host.taskDocumentGetFresh,
    };
    host.taskDocumentGet = taskDocumentGet;
    host.taskDocumentGetFresh = taskDocumentGetFresh;

    queryClient.setQueryData(documentQueryKeys.plan("/repo", "task-1"), {
      markdown: "# Plan V1",
      updatedAt: "2026-03-28T09:05:00.000Z",
    });
    queryClient.setQueryData(documentQueryKeys.qaReport("/repo", "task-1"), {
      markdown: "# QA V1",
      updatedAt: "2026-03-28T09:10:00.000Z",
    });

    try {
      await refreshCachedTaskDocumentQueries(queryClient, "/repo", "task-1");

      expect(taskDocumentGet).not.toHaveBeenCalled();
      expect(taskDocumentGetFresh).toHaveBeenCalledWith("/repo", "task-1", "plan");
      expect(taskDocumentGetFresh).toHaveBeenCalledWith("/repo", "task-1", "qa");
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
          documentQueryKeys.plan("/repo", "task-1"),
        ),
      ).toEqual({ markdown: "# Plan V2", updatedAt: "2026-03-28T10:05:00.000Z" });
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
          documentQueryKeys.qaReport("/repo", "task-1"),
        ),
      ).toEqual({ markdown: "# QA V2", updatedAt: "2026-03-28T10:10:00.000Z" });
    } finally {
      host.taskDocumentGet = original.taskDocumentGet;
      host.taskDocumentGetFresh = original.taskDocumentGetFresh;
      queryClient.clear();
    }
  });
});
