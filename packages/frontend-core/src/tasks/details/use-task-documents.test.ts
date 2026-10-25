import "../../test-support/dom-environment";
import { describe, expect, mock, test } from "bun:test";
import { useQueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import type { ClientConnection } from "../../connection/client-connection";
import { ClientConnectionProvider } from "../../connection/client-connection-react";
import { createClientQueryClient } from "../../connection/client-query-client";
import {
  documentQueryKeys,
  taskDocumentQueryOptions,
  type TaskDocumentReader,
} from "../../queries/documents";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import type { TaskDocumentPayload } from "../../types/task-documents";
import { ensureTaskDocumentQueryData } from "./task-document-query-data";
import { type TaskDocumentState, useTaskDocuments } from "./use-task-documents";

const REPO = "/use-task-documents-test/repo";
const TASK_ID = "task-1";
const document = (markdown: string, updatedAt = "2026-05-07T20:00:00.000Z") => ({
  markdown,
  updatedAt,
});

const renderDocuments = (connection: ClientConnection, initiallyOpen = true) =>
  renderHook(
    ({ taskId, repo, open }) => ({
      documents: useTaskDocuments(taskId, open, repo),
      queryClient: useQueryClient(),
    }),
    {
      initialProps: { taskId: TASK_ID, repo: REPO, open: initiallyOpen },
      wrapper: ({ children }: PropsWithChildren) =>
        createElement(ClientConnectionProvider, { connection }, children),
    },
  );
type DocumentView = ReturnType<typeof renderDocuments>;

const withDocuments = async (
  read: TaskDocumentReader,
  run: (view: DocumentView) => Promise<void>,
) => {
  // The hook has no reader override. The test host supplies the reads.
  const connection = createTestClientConnection({ client: { taskWorkflowArtifactGet: read } });
  let view: DocumentView | undefined;
  try {
    view = renderDocuments(connection);
    await run(view);
  } finally {
    view?.unmount();
    view?.result.current.queryClient.clear();
  }
};

const waitForDocuments = (
  view: DocumentView,
  expected: Partial<Record<"specDoc" | "planDoc" | "qaDoc", Partial<TaskDocumentState>>>,
) => waitFor(() => expect(view.result.current.documents).toMatchObject(expected), { timeout: 500 });

const cachedSpec = (view: DocumentView, repo = REPO, taskId = TASK_ID) =>
  view.result.current.queryClient.getQueryData<TaskDocumentPayload>(
    documentQueryKeys.spec(repo, taskId),
  );

describe("useTaskDocuments", () => {
  test("document query ensure revalidates stale cached documents on demand", async () => {
    const queryClient = createClientQueryClient();
    const queryKey = documentQueryKeys.plan(REPO, TASK_ID);
    const cached = document("# Cached plan");
    const fresh = document("# Fresh plan", "2026-05-07T20:05:00.000Z");
    const read = mock(async () => fresh);
    queryClient.setQueryData(queryKey, cached);
    try {
      await queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "none" });
      const options = taskDocumentQueryOptions(queryClient, REPO, TASK_ID, "plan", read);
      expect(await ensureTaskDocumentQueryData(queryClient, options)).toEqual(cached);
      await waitFor(
        () => {
          expect(queryClient.getQueryData<TaskDocumentPayload>(queryKey)).toEqual(fresh);
        },
        { timeout: 500 },
      );
      expect(read).toHaveBeenCalledTimes(1);
    } finally {
      queryClient.clear();
    }
  });

  test("a late empty read cannot replace an optimistic document update", async () => {
    const pendingRead = Promise.withResolvers<TaskDocumentPayload>();
    const read = mock(async (_repo: string, _taskId: string, section: string) =>
      section === "spec" ? pendingRead.promise : document(`${section} content`),
    );
    const optimistic = document("# Saved spec", "2026-05-07T20:05:00.000Z");
    await withDocuments(read, async (view) => {
      expect(read).toHaveBeenCalledWith(REPO, TASK_ID, "spec");
      expect(view.result.current.documents.specDoc.isLoading).toBe(true);
      act(() => view.result.current.documents.applyDocumentUpdate("spec", optimistic));
      await waitForDocuments(view, { specDoc: optimistic });
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
      expect(cachedSpec(view)).toEqual(optimistic);
    });
  });

  test("reload starts a fresh read while the initial read is in flight", async () => {
    const initialRead = Promise.withResolvers<TaskDocumentPayload>();
    const reloadRead = Promise.withResolvers<TaskDocumentPayload>();
    let specReads = 0;
    const read: TaskDocumentReader = async (_repo, _taskId, section) => {
      if (section !== "spec") {
        return document(`${section} content`);
      }
      specReads += 1;
      return specReads === 1 ? initialRead.promise : reloadRead.promise;
    };
    const fresh = document("# Reloaded spec", "2026-05-07T20:05:00.000Z");
    await withDocuments(read, async (view) => {
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
      await waitForDocuments(view, { specDoc: fresh });
      // Even a later timestamp from the canceled read must not undo the requested reload.
      await act(async () => {
        initialRead.resolve(document("# Canceled read", "2026-05-07T20:10:00.000Z"));
        await initialRead.promise;
      });
      expect(view.result.current.documents.specDoc.markdown).toBe(fresh.markdown);
      expect(cachedSpec(view)).toEqual(fresh);
      expect(view.result.current.documents.planDoc.markdown).toBe("plan content");
      expect(view.result.current.documents.qaDoc.markdown).toBe("qa content");
    });
  });

  test.each([
    { name: "task", repo: REPO, taskId: "task-2" },
    { name: "workspace", repo: "/use-task-documents-test/other-repo", taskId: TASK_ID },
  ])("a $name change keeps late reads and reloads in their own query keys", async (next) => {
    const oldRead = Promise.withResolvers<TaskDocumentPayload>();
    const nextRead = Promise.withResolvers<TaskDocumentPayload>();
    let reloading = false;
    const oldDocument = document("# Old scope spec");
    const nextDocument = document("# Next scope spec");
    const fresh = document("# Reloaded next spec", "2026-05-07T20:05:00.000Z");
    const read = mock(async (repo: string, taskId: string, section: string) => {
      const oldScope = repo === REPO && taskId === TASK_ID;
      if (section !== "spec") {
        return document(`${section} ${oldScope ? "old" : "next"}`);
      }
      if (oldScope) {
        return oldRead.promise;
      }
      return reloading ? fresh : nextRead.promise;
    });
    await withDocuments(read, async (view) => {
      await waitForDocuments(view, { planDoc: { markdown: "plan old" } });
      view.rerender({ repo: next.repo, taskId: next.taskId, open: true });
      expect(view.result.current.documents.specDoc.markdown).toBe("");
      expect(view.result.current.documents.specDoc.isLoading).toBe(true);
      await act(async () => {
        nextRead.resolve(nextDocument);
        await nextRead.promise;
      });
      await waitForDocuments(view, {
        specDoc: nextDocument,
        planDoc: { markdown: "plan next" },
        qaDoc: { markdown: "qa next" },
      });
      await act(async () => {
        oldRead.resolve(oldDocument);
        await oldRead.promise;
      });
      expect(cachedSpec(view)).toEqual(oldDocument);
      expect(view.result.current.documents.specDoc.markdown).toBe(nextDocument.markdown);
      reloading = true;
      act(() => {
        expect(view.result.current.documents.reloadDocument("spec")).toBe(true);
      });
      await waitForDocuments(view, { specDoc: fresh });
      expect(read).toHaveBeenLastCalledWith(next.repo, next.taskId, "spec");
      expect(cachedSpec(view)).toEqual(oldDocument);
      expect(cachedSpec(view, next.repo, next.taskId)).toEqual(fresh);
    });
  });

  test("a failed refresh shows an error, preserves cached content, and can recover", async () => {
    const failedRead = Promise.withResolvers<TaskDocumentPayload>();
    let failRefresh = false;
    const cached = document("# Cached spec");
    const failure = "Task store is unavailable. Reopen the workspace and reload the document.";
    await withDocuments(
      async (_repo, _taskId, section) =>
        failRefresh && section === "spec" ? failedRead.promise : cached,
      async (view) => {
        await waitForDocuments(view, { specDoc: cached });
        failRefresh = true;
        act(() => view.result.current.documents.reloadDocument("spec"));
        await act(async () => failedRead.reject(new Error(failure)));
        await waitForDocuments(view, { specDoc: { error: failure } });
        expect(view.result.current.documents.specDoc).toEqual({
          ...cached,
          loaded: true,
          isLoading: false,
          error: failure,
        });
        expect(cachedSpec(view)).toEqual(cached);
        failRefresh = false;
        act(() => view.result.current.documents.reloadDocument("spec"));
        await waitForDocuments(view, { specDoc: { ...cached, error: null } });
      },
    );
  });

  test("an opened document view shows cached sections and applies a newer section update", async () => {
    const view = renderDocuments(createTestClientConnection(), false);

    try {
      act(() => {
        const queryClient = view.result.current.queryClient;
        queryClient.setQueryData(documentQueryKeys.spec(REPO, TASK_ID), document("spec V1"));
        queryClient.setQueryData(documentQueryKeys.plan(REPO, TASK_ID), document("plan V1"));
        queryClient.setQueryData(documentQueryKeys.qaReport(REPO, TASK_ID), document("qa V1"));
      });
      view.rerender({ taskId: TASK_ID, repo: REPO, open: true });
      await waitForDocuments(view, {
        specDoc: { markdown: "spec V1" },
        planDoc: { markdown: "plan V1" },
        qaDoc: { markdown: "qa V1" },
      });
      act(() => {
        view.result.current.documents.applyDocumentUpdate(
          "spec",
          document("spec V2", "2026-05-07T20:05:00.000Z"),
        );
      });
      await waitForDocuments(view, {
        specDoc: { markdown: "spec V2" },
        planDoc: { markdown: "plan V1" },
        qaDoc: { markdown: "qa V1" },
      });
    } finally {
      view.unmount();
      view.result.current.queryClient.clear();
    }
  });
});
