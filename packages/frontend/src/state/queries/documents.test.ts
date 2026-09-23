import { describe, expect, mock, test } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { createQueryClient } from "@/lib/query-client";
import { QueryProvider } from "@/lib/query-provider";
import { useTaskDocuments } from "@/components/features/task-details/use-task-documents";
import {
  documentQueryKeys,
  fetchFreshTaskDocumentFromQuery,
  taskDocumentQueryOptions,
  type TaskDocumentSection,
} from "./documents";

const document = (markdown: string, updatedAt: string) => ({ markdown, updatedAt });

describe("documents query helpers", () => {
  test("normal views cache each section and a Query refetch reaches the reader", async () => {
    const queryClient = createQueryClient();
    let version = 1;
    const read = mock(async (_repoPath: string, _taskId: string, section: string) =>
      document(`${section} V${version}`, `2026-03-28T0${version}:00:00.000Z`),
    );
    const load = (section: TaskDocumentSection) =>
      queryClient.fetchQuery(
        taskDocumentQueryOptions(queryClient, "/repo", "task-1", section, read),
      );

    try {
      expect((await load("spec")).markdown).toBe("spec V1");
      expect((await load("plan")).markdown).toBe("plan V1");
      expect((await load("qa")).markdown).toBe("qa V1");
      await load("spec");
      expect(read).toHaveBeenCalledTimes(3);

      version = 2;
      await queryClient.invalidateQueries({ queryKey: documentQueryKeys.all, refetchType: "none" });
      expect((await load("spec")).markdown).toBe("spec V2");
      expect((await load("plan")).markdown).toBe("plan V2");
      expect((await load("qa")).markdown).toBe("qa V2");
      expect(read).toHaveBeenCalledTimes(6);
    } finally {
      queryClient.clear();
    }
  });

  test("explicit refresh reads the host and updates the cached spec", async () => {
    const queryClient = createQueryClient();
    const read = mock(async () => document("# Spec V2", "2026-03-28T10:00:00.000Z"));
    queryClient.setQueryData(
      documentQueryKeys.spec("/repo", "task-1"),
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
        queryClient.getQueryData<typeof fresh>(documentQueryKeys.spec("/repo", "task-1")),
      ).toEqual(fresh);
    } finally {
      queryClient.clear();
    }
  });

  test("explicit refresh keeps newer optimistic content when the host response is older", async () => {
    const queryClient = createQueryClient();
    const read = mock(async () => document("# Spec V1", "2026-03-28T09:00:00.000Z"));
    queryClient.setQueryData(
      documentQueryKeys.spec("/repo", "task-1"),
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
    const queryClient = createQueryClient();
    let incoming = document("# Older spec", "2026-03-28T09:00:00.000Z");
    const read = mock(async () => incoming);
    const queryKey = documentQueryKeys.spec("/repo", "task-1");
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

  test("a mounted document view applies a newer section update", async () => {
    const view = renderHook(
      ({ open }) => ({
        documents: useTaskDocuments("task-1", open, "/repo"),
        queryClient: useQueryClient(),
      }),
      {
        initialProps: { open: false },
        wrapper: ({ children }) =>
          createElement(QueryProvider, { useIsolatedClient: true }, children),
      },
    );

    try {
      act(() => {
        const queryClient = view.result.current.queryClient;
        queryClient.setQueryData(
          documentQueryKeys.spec("/repo", "task-1"),
          document("spec V1", "2026-03-28T09:00:00.000Z"),
        );
        queryClient.setQueryData(
          documentQueryKeys.plan("/repo", "task-1"),
          document("plan V1", "2026-03-28T09:00:00.000Z"),
        );
        queryClient.setQueryData(
          documentQueryKeys.qaReport("/repo", "task-1"),
          document("qa V1", "2026-03-28T09:00:00.000Z"),
        );
      });
      view.rerender({ open: true });
      await waitFor(() => {
        expect(view.result.current.documents.specDoc.markdown).toBe("spec V1");
        expect(view.result.current.documents.planDoc.markdown).toBe("plan V1");
        expect(view.result.current.documents.qaDoc.markdown).toBe("qa V1");
      });
      act(() => {
        view.result.current.documents.applyDocumentUpdate(
          "spec",
          document("spec V2", "2026-03-28T10:00:00.000Z"),
        );
      });
      await waitFor(() => {
        expect(view.result.current.documents.specDoc.markdown).toBe("spec V2");
        expect(view.result.current.documents.planDoc.markdown).toBe("plan V1");
        expect(view.result.current.documents.qaDoc.markdown).toBe("qa V1");
      });
    } finally {
      view.unmount();
    }
  });

  test("host failures reach explicit refresh callers", async () => {
    const queryClient = createQueryClient();
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
    const queryClient = createQueryClient();
    const read = mock(async () => document("# Spec", "2026-03-28T10:00:00.000Z"));

    try {
      await expect(
        queryClient.fetchQuery(taskDocumentQueryOptions(queryClient, "", "task-1", "spec", read)),
      ).rejects.toThrow("Select a repository before loading task documents.");
      expect(read).not.toHaveBeenCalled();
    } finally {
      queryClient.clear();
    }
  });
});
