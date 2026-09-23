import { describe, expect, mock, test } from "bun:test";
import { createQueryClient } from "@/lib/query-client";
import { host } from "@/state/operations/host";
import {
  documentQueryKeys,
  fetchFreshTaskDocumentFromQuery,
  loadPlanDocumentFromQuery,
  loadQaReportDocumentFromQuery,
  loadSpecDocumentFromQuery,
  refreshCachedTaskDocumentQueries,
} from "./documents";

const document = (markdown: string, updatedAt: string) => ({ markdown, updatedAt });

describe("documents query helpers", () => {
  test("normal views cache each section and a Query refetch reaches the host", async () => {
    const queryClient = createQueryClient();
    let version = 1;
    const read = mock(async (_repoPath: string, _taskId: string, section: string) =>
      document(`${section} V${version}`, `2026-03-28T0${version}:00:00.000Z`),
    );
    const original = host.taskDocumentGet;
    host.taskDocumentGet = read;

    try {
      expect((await loadSpecDocumentFromQuery(queryClient, "/repo", "task-1")).markdown).toBe(
        "spec V1",
      );
      expect((await loadPlanDocumentFromQuery(queryClient, "/repo", "task-1")).markdown).toBe(
        "plan V1",
      );
      expect((await loadQaReportDocumentFromQuery(queryClient, "/repo", "task-1")).markdown).toBe(
        "qa V1",
      );
      await loadSpecDocumentFromQuery(queryClient, "/repo", "task-1");
      expect(read).toHaveBeenCalledTimes(3);

      version = 2;
      await queryClient.invalidateQueries({ queryKey: documentQueryKeys.all, refetchType: "none" });
      expect((await loadSpecDocumentFromQuery(queryClient, "/repo", "task-1")).markdown).toBe(
        "spec V2",
      );
      expect((await loadPlanDocumentFromQuery(queryClient, "/repo", "task-1")).markdown).toBe(
        "plan V2",
      );
      expect((await loadQaReportDocumentFromQuery(queryClient, "/repo", "task-1")).markdown).toBe(
        "qa V2",
      );
      expect(read).toHaveBeenCalledTimes(6);
    } finally {
      host.taskDocumentGet = original;
      queryClient.clear();
    }
  });

  test("explicit refresh reads the host and updates the cached spec", async () => {
    const queryClient = createQueryClient();
    const read = mock(async () => document("# Spec V2", "2026-03-28T10:00:00.000Z"));
    const original = host.taskDocumentGet;
    host.taskDocumentGet = read;
    queryClient.setQueryData(
      documentQueryKeys.spec("/repo", "task-1"),
      document("# Spec V1", "2026-03-28T09:00:00.000Z"),
    );

    try {
      const fresh = await fetchFreshTaskDocumentFromQuery(queryClient, "/repo", "task-1", "spec");
      expect(fresh.markdown).toBe("# Spec V2");
      expect(read).toHaveBeenCalledWith("/repo", "task-1", "spec");
      expect(
        queryClient.getQueryData<typeof fresh>(documentQueryKeys.spec("/repo", "task-1")),
      ).toEqual(fresh);
    } finally {
      host.taskDocumentGet = original;
      queryClient.clear();
    }
  });

  test("explicit refresh keeps newer optimistic content when the host response is older", async () => {
    const queryClient = createQueryClient();
    const original = host.taskDocumentGet;
    host.taskDocumentGet = mock(async () => document("# Spec V1", "2026-03-28T09:00:00.000Z"));
    queryClient.setQueryData(
      documentQueryKeys.spec("/repo", "task-1"),
      document("# Optimistic spec", "2026-03-28T10:00:00.000Z"),
    );

    try {
      const fresh = await fetchFreshTaskDocumentFromQuery(queryClient, "/repo", "task-1", "spec");
      expect(fresh.markdown).toBe("# Optimistic spec");
    } finally {
      host.taskDocumentGet = original;
      queryClient.clear();
    }
  });

  test("stream refresh reads only cached sections", async () => {
    const queryClient = createQueryClient();
    const read = mock(async (_repoPath: string, _taskId: string, section: string) =>
      document(`${section} V2`, "2026-03-28T10:00:00.000Z"),
    );
    const original = host.taskDocumentGet;
    host.taskDocumentGet = read;
    queryClient.setQueryData(
      documentQueryKeys.plan("/repo", "task-1"),
      document("plan V1", "2026-03-28T09:00:00.000Z"),
    );
    queryClient.setQueryData(
      documentQueryKeys.qaReport("/repo", "task-1"),
      document("qa V1", "2026-03-28T09:00:00.000Z"),
    );

    try {
      await refreshCachedTaskDocumentQueries(queryClient, "/repo", ["task-1"]);
      expect(read).toHaveBeenCalledTimes(2);
      expect(read).toHaveBeenCalledWith("/repo", "task-1", "plan");
      expect(read).toHaveBeenCalledWith("/repo", "task-1", "qa");
      expect(
        queryClient.getQueryData<ReturnType<typeof document>>(
          documentQueryKeys.plan("/repo", "task-1"),
        ),
      ).toEqual(document("plan V2", "2026-03-28T10:00:00.000Z"));
      expect(
        queryClient.getQueryData<ReturnType<typeof document>>(
          documentQueryKeys.qaReport("/repo", "task-1"),
        ),
      ).toEqual(document("qa V2", "2026-03-28T10:00:00.000Z"));
    } finally {
      host.taskDocumentGet = original;
      queryClient.clear();
    }
  });

  test("host failures reach explicit refresh callers", async () => {
    const queryClient = createQueryClient();
    const failure = new Error("Task store is unavailable");
    const original = host.taskDocumentGet;
    host.taskDocumentGet = mock(async () => {
      throw failure;
    });

    try {
      await expect(
        fetchFreshTaskDocumentFromQuery(queryClient, "/repo", "task-1", "plan"),
      ).rejects.toBe(failure);
    } finally {
      host.taskDocumentGet = original;
      queryClient.clear();
    }
  });
});
