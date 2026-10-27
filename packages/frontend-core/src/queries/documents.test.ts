import { describe, expect, mock, test } from "bun:test";
import { createClientQueryClient } from "../connection/client-query-client";
import {
  documentQueryKeys,
  fetchFreshTaskDocumentFromQuery,
  taskDocumentQueryOptions,
} from "./documents";

const document = (markdown: string, updatedAt: string) => ({ markdown, updatedAt });

describe("documents query helpers", () => {
  test("normal views cache each section and a Query refetch reaches the reader", async () => {
    const queryClient = createClientQueryClient();
    let version = 1;
    const read = mock(async (_repoPath: string, _taskId: string, section: string) =>
      document(`${section} V${version}`, `2026-03-28T0${version}:00:00.000Z`),
    );
    const load = (section: string) =>
      queryClient.fetchQuery(
        taskDocumentQueryOptions(queryClient, "/repo", "task-1", section, read),
      );

    try {
      expect((await load("spec")).markdown).toBe("spec V1");
      expect((await load("plan")).markdown).toBe("plan V1");
      expect((await load("qaReport")).markdown).toBe("qaReport V1");
      await load("spec");
      expect(read).toHaveBeenCalledTimes(3);

      version = 2;
      await queryClient.invalidateQueries({ queryKey: documentQueryKeys.all, refetchType: "none" });
      expect((await load("spec")).markdown).toBe("spec V2");
      expect((await load("plan")).markdown).toBe("plan V2");
      expect((await load("qaReport")).markdown).toBe("qaReport V2");
      expect(read).toHaveBeenCalledTimes(6);
    } finally {
      queryClient.clear();
    }
  });

  test("explicit refresh reads the host and updates the cached spec", async () => {
    const queryClient = createClientQueryClient();
    const read = mock(async () => document("# Spec V2", "2026-03-28T10:00:00.000Z"));
    queryClient.setQueryData(
      documentQueryKeys.document("/repo", "task-1", "spec"),
      document("# Spec V1", "2026-03-28T09:00:00.000Z"),
    );

    try {
      const fresh = await fetchFreshTaskDocumentFromQuery(
        queryClient,
        "/repo",
        "task-1",
        "spec",
        read,
      );
      expect(fresh.markdown).toBe("# Spec V2");
      expect(read).toHaveBeenCalledWith("/repo", "task-1", "spec");
      expect(
        queryClient.getQueryData<typeof fresh>(
          documentQueryKeys.document("/repo", "task-1", "spec"),
        ),
      ).toEqual(fresh);
    } finally {
      queryClient.clear();
    }
  });

  test("explicit refresh keeps newer optimistic content when the host response is older", async () => {
    const queryClient = createClientQueryClient();
    const read = mock(async () => document("# Spec V1", "2026-03-28T09:00:00.000Z"));
    queryClient.setQueryData(
      documentQueryKeys.document("/repo", "task-1", "spec"),
      document("# Optimistic spec", "2026-03-28T10:00:00.000Z"),
    );

    try {
      const fresh = await fetchFreshTaskDocumentFromQuery(
        queryClient,
        "/repo",
        "task-1",
        "spec",
        read,
      );
      expect(fresh.markdown).toBe("# Optimistic spec");
    } finally {
      queryClient.clear();
    }
  });

  test("a normal Query refetch keeps newer optimistic content and accepts a later host version", async () => {
    const queryClient = createClientQueryClient();
    let incoming = document("# Older spec", "2026-03-28T09:00:00.000Z");
    const read = mock(async () => incoming);
    const queryKey = documentQueryKeys.document("/repo", "task-1", "spec");
    const loadSpec = () =>
      queryClient.fetchQuery(
        taskDocumentQueryOptions(queryClient, "/repo", "task-1", "spec", read),
      );
    queryClient.setQueryData(queryKey, document("# Optimistic spec", "2026-03-28T10:00:00.000Z"));

    try {
      await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
      expect((await loadSpec()).markdown).toBe("# Optimistic spec");
      incoming = document("# Host spec", "2026-03-28T11:00:00.000Z");
      await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
      expect((await loadSpec()).markdown).toBe("# Host spec");
      expect(read).toHaveBeenCalledTimes(2);
    } finally {
      queryClient.clear();
    }
  });

  test("host failures reach explicit refresh callers", async () => {
    const queryClient = createClientQueryClient();
    const failure = new Error("Task store is unavailable");
    const read = mock(async () => {
      throw failure;
    });

    try {
      await expect(
        fetchFreshTaskDocumentFromQuery(queryClient, "/repo", "task-1", "plan", read),
      ).rejects.toBe(failure);
    } finally {
      queryClient.clear();
    }
  });

  test("a read without a repository reports the missing selection", async () => {
    const queryClient = createClientQueryClient();
    const read = mock(async () => document("# Spec", "2026-03-28T10:00:00.000Z"));

    try {
      await expect(
        queryClient.fetchQuery(taskDocumentQueryOptions(queryClient, "", "task-1", "spec", read)),
      ).rejects.toThrow("Select a repository before loading task artifacts.");
      expect(read).not.toHaveBeenCalled();
    } finally {
      queryClient.clear();
    }
  });
});
