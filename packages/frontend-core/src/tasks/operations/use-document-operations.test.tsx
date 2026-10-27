import { workflowArtifactId } from "@openducktor/contracts";
import type { TaskArtifactSaveResult, WorkflowTaskArtifact } from "@openducktor/contracts";
import { boardEvent, eventCursor } from "../../queries/task-view-sync.test-support";
import { describe, expect, mock, test } from "bun:test";
import {
  defaultSpecTemplateMarkdown,
  type BuiltinTaskCard as TaskCard,
} from "@openducktor/workflows";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { documentQueryKeys, taskDocumentQueryOptions } from "../../queries/documents";
import { taskArtifactsQueryOptions } from "../../queries/artifacts";
import type { TaskDocumentPayload } from "../../types/task-documents";
import { createTaskCardFixture } from "../../test-support/shared-test-fixtures";
import { createTestClientConnection } from "../../test-support/test-client-connection";
import { createTaskViewSync } from "../../queries/task-view-sync";
import { taskQueryKeys, type RepoTaskData } from "../../queries/tasks";
import {
  createDocumentOperations,
  type CreateDocumentOperationsArgs,
  type DocumentOperationsHost,
} from "./use-document-operations";

const saveResult = (updatedAt: string): TaskArtifactSaveResult => ({
  updatedAt,
  cursor: eventCursor(Date.parse(updatedAt)),
});

const createQueryClient = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // Document save guards resolve the host through the connection that owns the query client.
  createTestClientConnection({ queryClient });
  return queryClient;
};

const createOperations = ({
  activeRepoPath = "/repo-a",
  queryClient = createQueryClient(),
  host: hostOverrides = {},
  loadDocument = mock(async () => ({ markdown: "", updatedAt: null })),
}: {
  activeRepoPath?: string | null;
  queryClient?: QueryClient;
  host?: Partial<DocumentOperationsHost>;
  loadDocument?: CreateDocumentOperationsArgs["loadDocument"];
} = {}) => {
  const host: DocumentOperationsHost = {
    workflowArtifactSave: mock(async () => saveResult("2026-02-22T10:03:00.000Z")),
    ...hostOverrides,
  };

  return {
    operations: createDocumentOperations({ activeRepoPath, host, queryClient, loadDocument }),
    host,
    queryClient,
  };
};

describe("createDocumentOperations", () => {
  for (const section of ["spec", "plan"] as const) {
    const method = `saveDocument(${section})`;
    test(`${method} updates the shared workflow body without a content read`, async () => {
      let revision = 1;
      const updatedAt = "2026-04-10T13:10:00.000Z";
      const artifact = (): WorkflowTaskArtifact => ({
        artifactId: workflowArtifactId("task-1", section),
        taskId: "task-1",
        name: section === "spec" ? "Specification" : "Implementation Plan",
        classification: "workflow",
        code: section,
        mediaType: "text/markdown",
        revision,
        updatedAt,
      });
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      const readWorkflow = mock(async () => ({ markdown: "# Before", updatedAt }));
      createTestClientConnection({
        queryClient,
        client: {
          taskArtifactsList: async () => ({ artifacts: [artifact()], canManageFree: false }),
          workflowArtifactGet: readWorkflow,
        },
      });
      const listOptions = {
        ...taskArtifactsQueryOptions(queryClient, "/repo-a", "task-1"),
        staleTime: Infinity,
      };
      const contentOptions = {
        ...taskDocumentQueryOptions(queryClient, "/repo-a", "task-1", section),
        staleTime: Infinity,
      };
      await queryClient.fetchQuery(listOptions);
      await queryClient.fetchQuery(contentOptions);
      const stopList = new QueryObserver(queryClient, listOptions).subscribe(() => {});
      const stopContent = new QueryObserver(queryClient, contentOptions).subscribe(() => {});
      const save = async () => {
        revision = 2;
        return { updatedAt, cursor: eventCursor(10) };
      };
      const { operations } = createOperations({
        queryClient,
        host: { workflowArtifactSave: save },
      });
      try {
        await operations.saveDocument("task-1", section, defaultSpecTemplateMarkdown);
        expect(queryClient.getQueryData(listOptions.queryKey)).toEqual({
          artifacts: [artifact()],
          canManageFree: false,
        });
        const content = queryClient.getQueryData(contentOptions.queryKey);
        expect(content).toEqual({ markdown: defaultSpecTemplateMarkdown, updatedAt });
        expect(readWorkflow).toHaveBeenCalledTimes(1);
      } finally {
        stopContent();
        stopList();
        queryClient.clear();
      }
    });

    test.each([
      "older reset before reply",
      "older reset after reply",
      "newer reset before reply",
      "own event before reply",
      "own event after reply",
      "newer save before reply",
      "unrelated change after reply",
    ] as const)(`${method} orders equal-timestamp commits across %s`, async (change) => {
      const timestamp = "2026-04-10T13:10:00.000Z";
      const receipt = { updatedAt: timestamp, cursor: eventCursor(10) };
      let finish!: (result: TaskArtifactSaveResult) => void;
      const pending = new Promise<TaskArtifactSaveResult>((resolve) => {
        finish = resolve;
      });
      const { operations, queryClient } = createOperations({
        host: { workflowArtifactSave: () => pending },
      });
      const key = documentQueryKeys.document("/repo-a", "task-1", section);
      const initial = createTaskCardFixture({ id: "task-1" });
      initial.artifactSummary[section] = { present: true, updatedAt: "2026-04-10T13:09:00.000Z" };
      queryClient.setQueryData(taskQueryKeys.repoData("/repo-a"), { tasks: [initial] });
      queryClient.setQueryData(key, {
        markdown: "# Before",
        updatedAt: "2026-04-10T13:09:00.000Z",
      });
      const listTasks = mock(async () => [initial]);
      const loadFreshDocument = mock(async () => ({
        markdown: "# Unexpected read",
        updatedAt: timestamp,
      }));
      const sync = createTaskViewSync({ queryClient, ports: { listTasks, loadFreshDocument } });
      const completion = operations
        .saveDocument("task-1", section, defaultSpecTemplateMarkdown)
        .then(
          () => null,
          (error: Error) => error,
        );
      const apply = async (sequence: number, reset: boolean, written = true) => {
        const card = createTaskCardFixture({ id: initial.id, updatedAt: timestamp });
        card.artifactSummary[section] = reset
          ? { present: false }
          : { present: true, updatedAt: timestamp };
        const event = boardEvent("/repo-a", [card]);
        event.boardChanges!.artifactChanges = written
          ? [
              {
                taskId: card.id,
                artifactIds: [workflowArtifactId(card.id, section)],
                removedArtifactIds: [],
              },
            ]
          : [];
        await sync.reconcileExternalEvent(event, eventCursor(sequence));
      };
      try {
        if (change.endsWith("after reply")) {
          finish(receipt);
          expect(await completion).toBeNull();
        }
        if (change.startsWith("older reset")) await apply(9, true);
        if (change === "newer reset before reply") await apply(11, true);
        if (change.startsWith("own event")) await apply(10, false);
        if (change === "unrelated change after reply") await apply(11, false, false);
        const newer = `${defaultSpecTemplateMarkdown}\nNewer content`;
        if (change === "newer save before reply") {
          const result = { updatedAt: timestamp, cursor: eventCursor(11) };
          const next = createOperations({
            queryClient,
            host: { workflowArtifactSave: async () => result },
          });
          await next.operations.saveDocument("task-1", section, newer);
        }
        finish(receipt);
        const error = await completion;
        if (change === "newer reset before reply" || change === "newer save before reply") {
          expect(error).toBeInstanceOf(Error);
          expect(error?.message).toContain("Open it again");
        } else expect(error).toBeNull();
        const document = queryClient.getQueryData<TaskDocumentPayload>(key);
        expect(document?.markdown).toBe(
          change === "newer reset before reply"
            ? ""
            : change === "newer save before reply"
              ? newer
              : defaultSpecTemplateMarkdown,
        );
        expect(listTasks).not.toHaveBeenCalled();
        expect(loadFreshDocument).not.toHaveBeenCalled();
      } finally {
        finish(receipt);
        await completion;
        queryClient.clear();
      }
    });

    test(`${method} keeps a later save while queued snapshot recovery cancels an older read`, async () => {
      let finishRead!: (value: TaskDocumentPayload) => void;
      const pendingRead = new Promise<TaskDocumentPayload>((resolve) => {
        finishRead = resolve;
      });
      let finishBoard!: (value: TaskCard[]) => void;
      let boardResponse = new Promise<TaskCard[]>((resolve) => {
        finishBoard = resolve;
      });
      let boardReadStarted!: () => void;
      const boardStarted = new Promise<void>((resolve) => {
        boardReadStarted = resolve;
      });
      const saved = {
        markdown: defaultSpecTemplateMarkdown,
        updatedAt: "2026-04-10T13:12:00.000Z",
      };
      const { operations, queryClient } = createOperations({
        host: { workflowArtifactSave: async () => saveResult(saved.updatedAt) },
      });
      const old = { markdown: "# Before the gap", updatedAt: "2026-04-10T13:09:00.000Z" };
      const queryKey = documentQueryKeys.document("/repo-a", "task-1", section);
      queryClient.setQueryData(queryKey, old);
      const options = taskDocumentQueryOptions(
        queryClient,
        "/repo-a",
        "task-1",
        section,
        () => pendingRead,
      );
      const read = queryClient
        .fetchQuery({ ...options, staleTime: 0 })
        .catch((error: Error) => error);
      const observer = new QueryObserver(queryClient, { ...options, staleTime: Infinity });
      const unsubscribe = observer.subscribe(() => {});
      const listTasks = mock(async (repoPath: string) => {
        if (repoPath !== "/repo-a") return [];
        boardReadStarted();
        return boardResponse;
      });
      const loadFreshDocument = mock(async () => saved);
      const sync = createTaskViewSync({ queryClient, ports: { listTasks, loadFreshDocument } });
      const card = createTaskCardFixture({ id: "task-1", updatedAt: saved.updatedAt });
      card.artifactSummary[section] = { present: true, updatedAt: saved.updatedAt };
      const load = sync.loadWorkspace("/repo-a", { forceFresh: true });
      let recovery: Promise<unknown> | undefined;
      try {
        await boardStarted;
        recovery = sync.reconcileStreamSnapshot(["/repo-b"]);
        await operations.saveDocument("task-1", section, saved.markdown);
        boardResponse = Promise.resolve([card]);
        finishBoard([card]);
        await load;
        await recovery;
        expect(queryClient.getQueryData<TaskDocumentPayload>(queryKey)).toEqual(saved);
        expect(observer.getCurrentResult().data).toEqual(saved);
        expect(loadFreshDocument).not.toHaveBeenCalled();
      } finally {
        finishBoard([card]);
        finishRead(old);
        await Promise.all([load, recovery, read]);
        unsubscribe();
        queryClient.clear();
      }
    });

    test.each([
      "inactive reset with a document observer",
      "inactive reset without a document observer",
      "active task omitted from the board",
      "inactive task omitted from the board",
      "workspace without observers",
    ] as const)(`${method} rejects pre-snapshot saves across %s`, async (change) => {
      let finishSave!: (value: TaskArtifactSaveResult) => void;
      let saveResponse = new Promise<TaskArtifactSaveResult>((resolve) => {
        finishSave = resolve;
      });
      const { operations, queryClient } = createOperations({
        host: { workflowArtifactSave: () => saveResponse },
      });
      const omitted = change.includes("omitted");
      const unobserved = change === "workspace without observers";
      const activeRepoPath =
        change === "active task omitted from the board" ? "/repo-a" : unobserved ? null : "/repo-b";
      const initial = createTaskCardFixture({
        id: "task-1",
        status: omitted ? "closed" : "open",
        updatedAt: "2026-04-10T13:09:00.000Z",
      });
      initial.artifactSummary[section] = { present: true, updatedAt: initial.updatedAt };
      const old = { markdown: "# Before the gap", updatedAt: initial.updatedAt };
      const queryKey = documentQueryKeys.document("/repo-a", "task-1", section);
      queryClient.setQueryData(queryKey, old);
      queryClient.setQueryData(taskQueryKeys.repoData("/repo-a"), { tasks: [initial] });
      const reset = createTaskCardFixture({ ...initial, updatedAt: "2026-04-10T13:11:00.000Z" });
      reset.artifactSummary[section] = { present: false };
      const snapshotCards = omitted || unobserved ? [] : [reset];
      const listTasks = mock(async (repoPath: string) =>
        repoPath === "/repo-a" ? snapshotCards : [],
      );
      const boardObserver =
        activeRepoPath === "/repo-a" || unobserved
          ? null
          : new QueryObserver<RepoTaskData>(queryClient, {
              queryKey: taskQueryKeys.repoData("/repo-a"),
              queryFn: async () => ({ tasks: await listTasks("/repo-a") }),
              staleTime: Infinity,
            });
      const unsubscribeBoard = boardObserver?.subscribe(() => {});
      const loadDocument = mock(async () => ({ markdown: "", updatedAt: null }));
      const documentObserver =
        change === "inactive reset with a document observer" || activeRepoPath === "/repo-a"
          ? new QueryObserver(queryClient, {
              ...taskDocumentQueryOptions(queryClient, "/repo-a", "task-1", section, loadDocument),
              staleTime: Infinity,
            })
          : null;
      const unsubscribeDocument = documentObserver?.subscribe(() => {});
      const sync = createTaskViewSync({
        queryClient,
        ports: { listTasks, loadFreshDocument: loadDocument },
      });
      const completion = operations
        .saveDocument("task-1", section, defaultSpecTemplateMarkdown)
        .then(
          () => null,
          (error: Error) => error,
        );
      try {
        await sync.reconcileStreamSnapshot(activeRepoPath ? [activeRepoPath] : []);
        finishSave(saveResult("2026-04-10T13:10:00.000Z"));
        const outcome = await completion;
        expect(outcome).toBeInstanceOf(Error);
        expect(outcome?.message).toContain("Open it again");
        const recovered = activeRepoPath === "/repo-a" ? { markdown: "", updatedAt: null } : old;
        expect(queryClient.getQueryData<TaskDocumentPayload>(queryKey)).toEqual(recovered);
        expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(
          activeRepoPath !== "/repo-a",
        );
        if (documentObserver) expect(documentObserver.getCurrentResult().data).toEqual(recovered);
        expect(
          queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo-a"))?.tasks,
        ).toEqual(unobserved ? [initial] : snapshotCards);

        // A missing board card can also be a retained task outside the closed-task window.
        // A successful host save started after recovery still owns its completion.
        const later = {
          markdown: defaultSpecTemplateMarkdown,
          updatedAt: "2026-04-10T13:12:00.000Z",
        };
        saveResponse = Promise.resolve(saveResult(later.updatedAt));
        await operations.saveDocument("task-1", section, later.markdown);
        expect(queryClient.getQueryData<TaskDocumentPayload>(queryKey)).toEqual(later);
        expect(queryClient.getQueryState(queryKey)?.isInvalidated).toBe(false);
        expect(listTasks).toHaveBeenCalledTimes(
          unobserved ? 0 : activeRepoPath === "/repo-a" ? 1 : 2,
        );
        expect(loadDocument).toHaveBeenCalledTimes(activeRepoPath === "/repo-a" ? 1 : 0);
      } finally {
        finishSave(saveResult("2026-04-10T13:10:00.000Z"));
        await completion;
        unsubscribeDocument?.();
        unsubscribeBoard?.();
        queryClient.clear();
      }
    });

    test.each([
      "reset",
      "empty",
      "cold",
      "removed",
      "newer",
      "snapshot",
      "snapshot-start",
      "earlier-reset",
    ] as const)(`${method} preserves committed document state across %s`, async (change) => {
      let finishSave!: (value: TaskArtifactSaveResult) => void;
      const pendingSave = new Promise<TaskArtifactSaveResult>((resolve) => {
        finishSave = resolve;
      });
      const { operations, queryClient } = createOperations({
        host: { workflowArtifactSave: () => pendingSave },
      });
      const queryKey = documentQueryKeys.document("/repo-a", "task-1", section);
      const empty = { markdown: "", updatedAt: null };
      const old = { markdown: "# Initial", updatedAt: "2026-04-10T13:09:00.000Z" };
      const startsEmpty = change === "empty" || change === "cold";
      const initial = createTaskCardFixture({ id: "task-1", updatedAt: old.updatedAt });
      initial.artifactSummary[section] = startsEmpty
        ? { present: false }
        : { present: true, updatedAt: old.updatedAt };
      queryClient.setQueryData(taskQueryKeys.repoData("/repo-a"), { tasks: [initial] });
      if (change !== "cold") queryClient.setQueryData(queryKey, startsEmpty ? empty : old);
      const readDocument = mock(async () => old);
      const observer =
        change === "cold"
          ? null
          : new QueryObserver<TaskDocumentPayload>(queryClient, {
              queryKey,
              queryFn: readDocument,
              enabled: change !== "newer",
              staleTime: Infinity,
            });
      const unsubscribe = observer?.subscribe(() => {});
      let snapshotCards = [initial];
      let snapshotDocument: TaskDocumentPayload = old;
      const listTasks = mock(async () => snapshotCards);
      const loadFreshDocument = mock(async () => snapshotDocument);
      const sync = createTaskViewSync({
        queryClient,
        ports: { listTasks, loadFreshDocument },
      });
      const saved = {
        markdown: defaultSpecTemplateMarkdown,
        updatedAt: "2026-04-10T13:10:00.000Z",
      };
      const completion = operations.saveDocument("task-1", section, saved.markdown).then(
        () => null,
        (error: Error) => error,
      );
      try {
        const committedAt =
          change === "earlier-reset" ? "2026-04-10T13:09:30.000Z" : "2026-04-10T13:11:00.000Z";
        const card = createTaskCardFixture({ ...initial, updatedAt: committedAt });
        card.artifactSummary[section] =
          change === "newer" ? { present: true, updatedAt: committedAt } : { present: false };
        snapshotCards = [card];
        snapshotDocument = empty;
        if (change === "snapshot" || change === "snapshot-start") {
          const recovery = sync.reconcileStreamSnapshot(["/repo-a"]);
          if (change === "snapshot-start") finishSave(saveResult(saved.updatedAt));
          await recovery;
        } else
          await sync.reconcileExternalEvent(
            {
              kind: "tasks_updated",
              eventId: "committed-change",
              repoPath: "/repo-a",
              taskIds: ["task-1"],
              removedTaskIds: change === "removed" ? ["task-1"] : [],
              taskSnapshots:
                change === "removed"
                  ? []
                  : [{ id: card.id, title: card.title, status: card.status }],
              statusChanges: [],
              boardChanges: {
                artifactChanges: [],
                cards: change === "removed" ? [] : [card],
                doneVisibleDays: 1,
              },
              emittedAt: committedAt,
            },
            eventCursor(Date.parse(committedAt)),
          );
        finishSave(saveResult(saved.updatedAt));
        const outcome = await completion;
        if (change === "earlier-reset") {
          expect(outcome).toBeNull();
          expect(queryClient.getQueryData<TaskDocumentPayload>(queryKey)).toEqual(saved);
          expect(observer?.getCurrentResult().data).toEqual(saved);
        } else {
          expect(outcome).toBeInstanceOf(Error);
          expect(outcome?.message).toContain("Open it again");
          if (change === "removed") {
            expect(queryClient.getQueryData<TaskDocumentPayload>(queryKey)).toBeUndefined();
          } else {
            const expected = change === "newer" ? old : empty;
            expect(queryClient.getQueryData<TaskDocumentPayload>(queryKey)).toEqual(expected);
            if (observer) expect(observer.getCurrentResult().data).toEqual(expected);
          }
        }
        const board = queryClient.getQueryData<RepoTaskData>(taskQueryKeys.repoData("/repo-a"));
        expect(board?.tasks).toEqual(change === "removed" ? [] : [card]);
        const snapshotReads = change === "snapshot" || change === "snapshot-start" ? 1 : 0;
        expect(listTasks).toHaveBeenCalledTimes(snapshotReads);
        expect(loadFreshDocument).toHaveBeenCalledTimes(snapshotReads);
        expect(readDocument).not.toHaveBeenCalled();
      } finally {
        finishSave(saveResult(saved.updatedAt));
        await completion;
        unsubscribe?.();
        queryClient.clear();
      }
    });
  }

  test.each(["spec", "plan"] as const)(
    "a completed %s save owns cache acceptance and joined imperative reads",
    async (section) => {
      let finishRead!: (value: { markdown: string; updatedAt: string }) => void;
      let finishSave!: (value: TaskArtifactSaveResult) => void;
      const pendingRead = new Promise<{ markdown: string; updatedAt: string }>((resolve) => {
        finishRead = resolve;
      });
      const pendingSave = new Promise<TaskArtifactSaveResult>((resolve) => {
        finishSave = resolve;
      });
      const { operations, queryClient } = createOperations({
        host: { workflowArtifactSave: () => pendingSave },
      });
      const options = () =>
        taskDocumentQueryOptions(queryClient, "/repo-a", "task-1", section, () => pendingRead);
      const read = queryClient.fetchQuery(options());
      const joinedRead = queryClient.fetchQuery(options());
      const observer = new QueryObserver(queryClient, options());
      const unsubscribe = observer.subscribe(() => {});
      try {
        const saved = { markdown: "# Saved", updatedAt: "2026-04-10T13:11:00.000Z" };
        const save = operations.saveDocument("task-1", section, saved.markdown);
        // The query function finishes before the save, but Query accepts it afterward.
        finishRead(Object.freeze({ markdown: "# Older", updatedAt: "2026-04-10T13:09:00.000Z" }));
        finishSave(saveResult(saved.updatedAt));
        const [result, joinedResult] = await Promise.all([read, joinedRead, save]);
        expect(result).toEqual(saved);
        expect(joinedResult).toEqual(saved);
        expect(queryClient.getQueryData<TaskDocumentPayload>(options().queryKey)).toEqual(saved);
        expect(observer.getCurrentResult().data).toEqual(saved);
      } finally {
        unsubscribe();
        queryClient.clear();
      }
    },
  );

  test("guards every operation when no active workspace is selected", async () => {
    const { operations } = createOperations({ activeRepoPath: null });

    await expect(operations.loadDocument("task-1", "qaReport")).rejects.toThrow(
      "Select a workspace first.",
    );
    await expect(operations.saveDocument("task-1", "spec", "# doc")).rejects.toThrow(
      "Select a workspace first.",
    );
  });

  test("loads a document of the active workspace by its code", async () => {
    const loadDocument = mock(async () => ({
      markdown: "# QA",
      updatedAt: "2026-02-22T10:02:00.000Z",
    }));
    const { operations } = createOperations({ loadDocument });

    await expect(operations.loadDocument("task-1", "qaReport")).resolves.toEqual({
      markdown: "# QA",
      updatedAt: "2026-02-22T10:02:00.000Z",
    });
    expect(loadDocument).toHaveBeenCalledWith("/repo-a", "task-1", "qaReport");
  });

  test("saves a draft without a workflow event and updates its cache entry", async () => {
    const workflowArtifactSave = mock(async () => saveResult("2026-02-22T10:03:00.000Z"));
    const { operations, queryClient } = createOperations({ host: { workflowArtifactSave } });
    const key = documentQueryKeys.document("/repo-a", "task-1", "plan");
    queryClient.setQueryData(key, {
      markdown: "# Old plan",
      updatedAt: "2026-02-22T10:00:00.000Z",
    });

    await expect(operations.saveDocument("task-1", "plan", "# New plan")).resolves.toEqual({
      updatedAt: "2026-02-22T10:03:00.000Z",
    });

    expect(workflowArtifactSave).toHaveBeenCalledWith({
      repoPath: "/repo-a",
      taskId: "task-1",
      code: "plan",
      markdown: "# New plan",
      submit: false,
    });
    expect(queryClient.getQueryData<TaskDocumentPayload>(key)).toEqual({
      markdown: "# New plan",
      updatedAt: "2026-02-22T10:03:00.000Z",
    });
  });

  test("keeps unrelated document caches unchanged after a document mutation", async () => {
    const { operations, queryClient } = createOperations();
    const otherKey = documentQueryKeys.document("/repo-b", "task-1", "spec");
    queryClient.setQueryData(documentQueryKeys.document("/repo-a", "task-1", "spec"), {
      markdown: "# Old spec",
      updatedAt: "2026-02-22T10:00:00.000Z",
    });
    queryClient.setQueryData(otherKey, {
      markdown: "# Other workspace spec",
      updatedAt: "2026-02-22T10:00:00.000Z",
    });

    await operations.saveDocument("task-1", "spec", "# New spec");

    expect(queryClient.getQueryState(otherKey)?.isInvalidated).toBe(false);
  });

  test.each(["spec", "plan"] as const)(
    "preserves a newer cached %s when a save response arrives out of order",
    async (code) => {
      const { operations, queryClient } = createOperations({
        host: { workflowArtifactSave: mock(async () => saveResult("2026-02-22T10:01:00.000Z")) },
      });
      const key = documentQueryKeys.document("/repo-a", "task-1", code);
      const newer = { markdown: "# Newer", updatedAt: "2026-02-22T10:05:00.000Z" };
      queryClient.setQueryData(key, newer);

      await expect(operations.saveDocument("task-1", code, "# Older response")).rejects.toThrow(
        "Open it again",
      );
      expect(queryClient.getQueryData<TaskDocumentPayload>(key)).toEqual(newer);
    },
  );
});
