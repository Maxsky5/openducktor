import { afterEach, describe, expect, mock, test } from "bun:test";
import { createQueryClient } from "@/lib/query-client";
import { host } from "@/state/operations/host";
import {
  documentQueryKeys,
  fetchTaskDocumentFromQuery,
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

  test("fetchTaskDocumentFromQuery performs a force-fresh authoritative read and updates the cache", async () => {
    const queryClient = createQueryClient();
    const specGet = mock(async () =>
      createDocumentPayload("# Spec V2", "2026-03-28T10:00:00.000Z"),
    );
    const originalSpecGet = host.specGet;
    host.specGet = specGet;

    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "# Spec V1",
      updatedAt: "2026-03-28T09:00:00.000Z",
    });

    try {
      const document = await fetchTaskDocumentFromQuery(queryClient, "/repo", "task-1", "spec", {
        forceFresh: true,
      });

      expect(document).toEqual({
        markdown: "# Spec V2",
        updatedAt: "2026-03-28T10:00:00.000Z",
      });
      expect(specGet).toHaveBeenCalledWith("/repo", "task-1", { forceFresh: true });
      expect(
        queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
          documentQueryKeys.spec("/repo", "task-1"),
        ),
      ).toEqual({ markdown: "# Spec V2", updatedAt: "2026-03-28T10:00:00.000Z" });
    } finally {
      host.specGet = originalSpecGet;
      queryClient.clear();
    }
  });

  test("fetchTaskDocumentFromQuery preserves newer optimistic content when the incoming payload is older", async () => {
    const queryClient = createQueryClient();
    const specGet = mock(async () =>
      createDocumentPayload("# Spec V1", "2026-03-28T09:00:00.000Z"),
    );
    const originalSpecGet = host.specGet;
    host.specGet = specGet;

    queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
      markdown: "# Optimistic spec",
      updatedAt: "2026-03-28T10:00:00.000Z",
    });

    try {
      const document = await fetchTaskDocumentFromQuery(queryClient, "/repo", "task-1", "spec", {
        forceFresh: true,
      });

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
      host.specGet = originalSpecGet;
      queryClient.clear();
    }
  });

  test("refreshCachedTaskDocumentQueries force-refreshes only cached sections", async () => {
    const queryClient = createQueryClient();
    const specGet = mock(async () =>
      createDocumentPayload("# Spec V2", "2026-03-28T10:00:00.000Z"),
    );
    const planGet = mock(async () =>
      createDocumentPayload("# Plan V2", "2026-03-28T10:05:00.000Z"),
    );
    const qaGetReport = mock(async () =>
      createDocumentPayload("# QA V2", "2026-03-28T10:10:00.000Z"),
    );
    const original = {
      specGet: host.specGet,
      planGet: host.planGet,
      qaGetReport: host.qaGetReport,
    };
    host.specGet = specGet;
    host.planGet = planGet;
    host.qaGetReport = qaGetReport;

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

      expect(specGet).not.toHaveBeenCalled();
      expect(planGet).toHaveBeenCalledWith("/repo", "task-1", { forceFresh: true });
      expect(qaGetReport).toHaveBeenCalledWith("/repo", "task-1", { forceFresh: true });
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
      host.specGet = original.specGet;
      host.planGet = original.planGet;
      host.qaGetReport = original.qaGetReport;
      queryClient.clear();
    }
  });
});
