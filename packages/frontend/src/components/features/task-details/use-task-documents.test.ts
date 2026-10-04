import { describe, expect, mock, test } from "bun:test";
import { QueryClient, useQueryClient } from "@tanstack/react-query";
import { act, render, renderHook, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { host } from "@/state/operations/host";
import {
  documentQueryKeys,
  taskDocumentQueryOptions,
  type TaskDocumentReader,
} from "@/state/queries/documents";
import { IsolatedQueryWrapper } from "@/test-utils/isolated-query-wrapper";
import type { TaskDocumentPayload } from "@/types/task-documents";
import { TaskDetailsAsyncDocumentSection } from "./task-details-async-document-section";
import { ensureTaskDocumentQueryData } from "./task-document-query-data";
import { useTaskDocuments } from "./use-task-documents";

const REPO = "/use-task-documents-test/repo";
const TASK_ID = "task-1";
const document = (markdown: string, updatedAt = "2026-05-07T20:00:00.000Z") => ({
  markdown,
  updatedAt,
});

const renderDocuments = (read: TaskDocumentReader) => {
  const originalRead = host.taskDocumentGet;
  // The hook has no reader override. The host proxy requires assignment and exact restoration.
  host.taskDocumentGet = (repo, taskId, section) =>
    repo.startsWith("/use-task-documents-test/")
      ? read(repo, taskId, section)
      : originalRead(repo, taskId, section);
  const view = renderHook(
    ({ taskId, repo }) => ({
      documents: useTaskDocuments(taskId, true, repo),
      queryClient: useQueryClient(),
    }),
    {
      initialProps: { taskId: TASK_ID, repo: REPO },
      wrapper: IsolatedQueryWrapper,
    },
  );

  return {
    ...view,
    dispose: () => {
      try {
        view.unmount();
        view.result.current.queryClient.clear();
      } finally {
        host.taskDocumentGet = originalRead;
      }
    },
  };
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

      const options = taskDocumentQueryOptions(
        queryClient,
        "/repo",
        "task-1",
        "plan",
        loadPlanDocument,
      );

      // Stale data returns immediately while the fresh read runs in the background.
      expect((await ensureTaskDocumentQueryData(queryClient, options)).markdown).toBe(
        "# Cached plan",
      );
      await waitFor(
        () => {
          expect(
            queryClient.getQueryData<TaskDocumentPayload>(documentQueryKeys.plan("/repo", "task-1"))
              ?.markdown,
          ).toBe("# Fresh plan");
        },
        { timeout: 500 },
      );

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

  test("a late empty read cannot replace an optimistic document update", async () => {
    const pendingRead = Promise.withResolvers<TaskDocumentPayload>();
    const read = mock(async (_repo: string, _taskId: string, section: string) =>
      section === "spec" ? pendingRead.promise : document(`${section} content`),
    );
    const view = renderDocuments(read);
    const optimistic = document("# Saved spec", "2026-05-07T20:05:00.000Z");

    try {
      expect(read).toHaveBeenCalledWith(REPO, TASK_ID, "spec");
      expect(view.result.current.documents.specDoc.isLoading).toBe(true);
      act(() => view.result.current.documents.applyDocumentUpdate("spec", optimistic));
      await waitFor(
        () => {
          expect(view.result.current.documents.specDoc.markdown).toBe(optimistic.markdown);
        },
        { timeout: 500 },
      );

      // An empty document has no timestamp, so cancellation must protect the saved update.
      await act(async () => {
        pendingRead.resolve({ markdown: "", updatedAt: null });
        await pendingRead.promise;
      });
      expect(view.result.current.documents.specDoc).toEqual({
        ...optimistic,
        loaded: true,
        isLoading: false,
        error: null,
      });
      expect(
        view.result.current.queryClient.getQueryData<TaskDocumentPayload>(
          documentQueryKeys.spec(REPO, TASK_ID),
        ),
      ).toEqual(optimistic);
    } finally {
      view.dispose();
    }
  });

  test("reload starts a fresh read while the initial read is in flight", async () => {
    const initialRead = Promise.withResolvers<TaskDocumentPayload>();
    const reloadRead = Promise.withResolvers<TaskDocumentPayload>();
    let specReads = 0;
    const read = mock(async (_repo: string, _taskId: string, section: string) => {
      if (section !== "spec") {
        return document(`${section} content`);
      }
      specReads += 1;
      return specReads === 1 ? initialRead.promise : reloadRead.promise;
    });
    const view = renderDocuments(read);
    const fresh = document("# Reloaded spec", "2026-05-07T20:05:00.000Z");

    try {
      expect(specReads).toBe(1);
      expect(view.result.current.documents.specDoc.isLoading).toBe(true);
      act(() => {
        expect(view.result.current.documents.reloadDocument("spec")).toBe(true);
      });
      await waitFor(() => expect(specReads).toBe(2), { timeout: 500 });
      await act(async () => {
        reloadRead.resolve(fresh);
        await reloadRead.promise;
      });
      await waitFor(
        () => {
          expect(view.result.current.documents.specDoc.markdown).toBe(fresh.markdown);
        },
        { timeout: 500 },
      );

      // Even a later timestamp from the canceled read must not undo the requested reload.
      await act(async () => {
        initialRead.resolve(document("# Canceled read", "2026-05-07T20:10:00.000Z"));
        await initialRead.promise;
      });
      expect(view.result.current.documents.specDoc.markdown).toBe(fresh.markdown);
      expect(
        view.result.current.queryClient.getQueryData<TaskDocumentPayload>(
          documentQueryKeys.spec(REPO, TASK_ID),
        ),
      ).toEqual(fresh);
      expect(view.result.current.documents.planDoc.markdown).toBe("plan content");
      expect(view.result.current.documents.qaDoc.markdown).toBe("qa content");
    } finally {
      view.dispose();
    }
  });

  test.each([
    { name: "task", repo: REPO, taskId: "task-2" },
    { name: "workspace", repo: "/use-task-documents-test/other-repo", taskId: TASK_ID },
  ])("a $name change keeps late reads and reloads in their own query keys", async (next) => {
    const oldRead = Promise.withResolvers<TaskDocumentPayload>();
    const nextRead = Promise.withResolvers<TaskDocumentPayload>();
    let reloading = false;
    const read = mock(async (repo: string, taskId: string, section: string) => {
      const oldScope = repo === REPO && taskId === TASK_ID;
      if (section !== "spec") {
        return document(`${section} ${oldScope ? "old" : "next"}`);
      }
      if (oldScope) {
        return oldRead.promise;
      }
      return reloading
        ? document("# Reloaded next spec", "2026-05-07T20:05:00.000Z")
        : nextRead.promise;
    });
    const view = renderDocuments(read);
    const oldDocument = document("# Old scope spec");
    const nextDocument = document("# Next scope spec");

    try {
      await waitFor(
        () => {
          expect(view.result.current.documents.planDoc.markdown).toBe("plan old");
        },
        { timeout: 500 },
      );
      view.rerender({ repo: next.repo, taskId: next.taskId });
      expect(view.result.current.documents.specDoc.markdown).toBe("");
      expect(view.result.current.documents.specDoc.isLoading).toBe(true);
      await act(async () => {
        nextRead.resolve(nextDocument);
        await nextRead.promise;
      });
      await waitFor(
        () => {
          expect(view.result.current.documents.specDoc.markdown).toBe(nextDocument.markdown);
          expect(view.result.current.documents.planDoc.markdown).toBe("plan next");
          expect(view.result.current.documents.qaDoc.markdown).toBe("qa next");
        },
        { timeout: 500 },
      );
      await act(async () => {
        oldRead.resolve(oldDocument);
        await oldRead.promise;
      });
      const queryClient = view.result.current.queryClient;
      expect(
        queryClient.getQueryData<TaskDocumentPayload>(documentQueryKeys.spec(REPO, TASK_ID)),
      ).toEqual(oldDocument);
      expect(view.result.current.documents.specDoc.markdown).toBe(nextDocument.markdown);

      reloading = true;
      act(() => {
        expect(view.result.current.documents.reloadDocument("spec")).toBe(true);
      });
      await waitFor(
        () => {
          expect(view.result.current.documents.specDoc.markdown).toBe("# Reloaded next spec");
        },
        { timeout: 500 },
      );
      expect(read).toHaveBeenLastCalledWith(next.repo, next.taskId, "spec");
      expect(
        queryClient.getQueryData<TaskDocumentPayload>(documentQueryKeys.spec(REPO, TASK_ID)),
      ).toEqual(oldDocument);
      expect(
        queryClient.getQueryData<TaskDocumentPayload>(
          documentQueryKeys.spec(next.repo, next.taskId),
        ),
      ).toEqual(document("# Reloaded next spec", "2026-05-07T20:05:00.000Z"));
    } finally {
      view.dispose();
    }
  });

  test("a failed refresh shows an error, preserves cached content, and can recover", async () => {
    const failedRead = Promise.withResolvers<TaskDocumentPayload>();
    let failRefresh = false;
    const cached = document("# Cached spec");
    const view = renderDocuments(async (_repo, _taskId, section) =>
      failRefresh && section === "spec" ? failedRead.promise : cached,
    );
    const failure = "Task store is unavailable. Reopen the workspace and reload the document.";

    try {
      await waitFor(
        () => {
          expect(view.result.current.documents.specDoc.markdown).toBe(cached.markdown);
        },
        { timeout: 500 },
      );
      failRefresh = true;
      act(() => view.result.current.documents.reloadDocument("spec"));
      await act(async () => failedRead.reject(new Error(failure)));
      await waitFor(
        () => {
          expect(view.result.current.documents.specDoc.error).toBe(failure);
        },
        { timeout: 500 },
      );
      expect(view.result.current.documents.specDoc).toEqual({
        ...cached,
        loaded: true,
        isLoading: false,
        error: failure,
      });
      expect(
        view.result.current.queryClient.getQueryData<TaskDocumentPayload>(
          documentQueryKeys.spec(REPO, TASK_ID),
        ),
      ).toEqual(cached);
      const section = render(
        createElement(TaskDetailsAsyncDocumentSection, {
          title: "Specification",
          icon: createElement("span"),
          empty: "No specification yet.",
          document: view.result.current.documents.specDoc,
          hasDocument: true,
          defaultExpanded: true,
          onLoad: () => {},
        }),
      );
      expect(section.getByText(failure)).toBeDefined();
      section.unmount();

      failRefresh = false;
      act(() => view.result.current.documents.reloadDocument("spec"));
      await waitFor(
        () => {
          expect(view.result.current.documents.specDoc.error).toBeNull();
          expect(view.result.current.documents.specDoc.markdown).toBe(cached.markdown);
        },
        { timeout: 500 },
      );
    } finally {
      view.dispose();
    }
  });
});
