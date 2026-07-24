import { describe, expect, mock, test } from "bun:test";
import { defaultSpecTemplateMarkdown } from "@openducktor/contracts";
import { QueryClient } from "@tanstack/react-query";
import { documentQueryKeys } from "@/state/queries/documents";
import type { TaskViewSync } from "@/state/queries/task-view-sync";
import {
  createSpecOperations,
  type SpecDocumentLoaders,
  type SpecOperationsHost,
} from "./use-spec-operations";

const createQueryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

const createOperations = ({
  activeRepoPath = "/repo-a",
  queryClient = createQueryClient(),
  host: hostOverrides = {},
  loaders: loaderOverrides = {},
  refreshAfterLocalMutation = mock(async () => {}),
}: {
  activeRepoPath?: string | null;
  queryClient?: QueryClient;
  host?: Partial<SpecOperationsHost>;
  loaders?: Partial<SpecDocumentLoaders>;
  refreshAfterLocalMutation?: TaskViewSync["refreshAfterLocalMutation"];
} = {}) => {
  const host: SpecOperationsHost = {
    setSpec: mock(async () => ({ updatedAt: "2026-02-22T10:06:00.000Z" })),
    saveSpecDocument: mock(async () => ({ updatedAt: "2026-02-22T10:03:00.000Z" })),
    savePlanDocument: mock(async () => ({ updatedAt: "2026-02-22T10:04:00.000Z" })),
    ...hostOverrides,
  };
  const loaders: SpecDocumentLoaders = {
    loadSpecDocument: mock(async () => ({ markdown: "", updatedAt: null })),
    loadPlanDocument: mock(async () => ({ markdown: "", updatedAt: null })),
    loadQaReportDocument: mock(async () => ({ markdown: "", updatedAt: null })),
    ...loaderOverrides,
  };
  const taskViewSync: Pick<TaskViewSync, "refreshAfterLocalMutation"> = {
    refreshAfterLocalMutation,
  };

  return {
    operations: createSpecOperations({
      activeRepoPath,
      host,
      queryClient,
      taskViewSync,
      ...loaders,
    }),
    host,
    loaders,
    queryClient,
    refreshAfterLocalMutation,
  };
};

describe("createSpecOperations", () => {
  test("guards every operation when no active workspace is selected", async () => {
    const { operations } = createOperations({ activeRepoPath: null });

    await expect(operations.loadSpecDocument("task-1")).rejects.toThrow(
      "Select a workspace first.",
    );
    await expect(operations.loadPlanDocument("task-1")).rejects.toThrow(
      "Select a workspace first.",
    );
    await expect(operations.loadQaReportDocument("task-1")).rejects.toThrow(
      "Select a workspace first.",
    );
    await expect(operations.saveSpec("task-1", defaultSpecTemplateMarkdown)).rejects.toThrow(
      "Select a workspace first.",
    );
    await expect(operations.saveSpecDocument("task-1", "# doc")).rejects.toThrow(
      "Select a workspace first.",
    );
    await expect(operations.savePlanDocument("task-1", "# plan")).rejects.toThrow(
      "Select a workspace first.",
    );
  });

  test("loads document variants and falls back to the default spec template", async () => {
    const loadSpecDocument = mock(async () => ({ markdown: "", updatedAt: null }));
    const loadPlanDocument = mock(async () => ({
      markdown: "# Plan",
      updatedAt: "2026-02-22T10:01:00.000Z",
    }));
    const loadQaReportDocument = mock(async () => ({
      markdown: "# QA",
      updatedAt: "2026-02-22T10:02:00.000Z",
    }));
    const { operations } = createOperations({
      loaders: { loadSpecDocument, loadPlanDocument, loadQaReportDocument },
    });

    await expect(operations.loadSpec("task-1")).resolves.toBe(defaultSpecTemplateMarkdown);
    await expect(operations.loadPlanDocument("task-1")).resolves.toEqual({
      markdown: "# Plan",
      updatedAt: "2026-02-22T10:01:00.000Z",
    });
    await expect(operations.loadQaReportDocument("task-1")).resolves.toEqual({
      markdown: "# QA",
      updatedAt: "2026-02-22T10:02:00.000Z",
    });

    expect(loadSpecDocument).toHaveBeenCalledWith("/repo-a", "task-1");
    expect(loadPlanDocument).toHaveBeenCalledWith("/repo-a", "task-1");
    expect(loadQaReportDocument).toHaveBeenCalledWith("/repo-a", "task-1");
  });

  test("rejects an invalid spec before issuing a mutation and permits a valid retry", async () => {
    const setSpec = mock(async () => ({ updatedAt: "2026-02-22T10:06:00.000Z" }));
    const { operations, refreshAfterLocalMutation } = createOperations({ host: { setSpec } });

    await expect(operations.saveSpec("task-1", "# Invalid")).rejects.toThrow(
      "Missing required sections:",
    );
    expect(setSpec).not.toHaveBeenCalled();

    await expect(operations.saveSpec("task-1", defaultSpecTemplateMarkdown)).resolves.toEqual({
      updatedAt: "2026-02-22T10:06:00.000Z",
    });
    expect(setSpec).toHaveBeenCalledWith({
      repoPath: "/repo-a",
      taskId: "task-1",
      markdown: defaultSpecTemplateMarkdown,
    });
    expect(refreshAfterLocalMutation).toHaveBeenCalledWith("/repo-a", {
      kind: "refresh-documents",
      taskIds: ["task-1"],
    });
  });

  test("saves spec and plan documents, updates their cache entries, and refreshes document views", async () => {
    const saveSpecDocument = mock(async () => ({ updatedAt: "2026-02-22T10:03:00.000Z" }));
    const savePlanDocument = mock(async () => ({ updatedAt: "2026-02-22T10:04:00.000Z" }));
    const { operations, queryClient, refreshAfterLocalMutation } = createOperations({
      host: { saveSpecDocument, savePlanDocument },
    });

    queryClient.setQueryData(documentQueryKeys.spec("/repo-a", "task-1"), {
      markdown: "# Old spec",
      updatedAt: "2026-02-22T10:00:00.000Z",
    });
    queryClient.setQueryData(documentQueryKeys.plan("/repo-a", "task-1"), {
      markdown: "# Old plan",
      updatedAt: "2026-02-22T10:00:00.000Z",
    });

    await expect(operations.saveSpecDocument("task-1", "# New spec")).resolves.toEqual({
      updatedAt: "2026-02-22T10:03:00.000Z",
    });
    await expect(operations.savePlanDocument("task-1", "# New plan")).resolves.toEqual({
      updatedAt: "2026-02-22T10:04:00.000Z",
    });

    expect(saveSpecDocument).toHaveBeenCalledWith({
      repoPath: "/repo-a",
      taskId: "task-1",
      markdown: "# New spec",
    });
    expect(savePlanDocument).toHaveBeenCalledWith({
      repoPath: "/repo-a",
      taskId: "task-1",
      markdown: "# New plan",
    });
    expect(
      queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
        documentQueryKeys.spec("/repo-a", "task-1"),
      ),
    ).toEqual({
      markdown: "# New spec",
      updatedAt: "2026-02-22T10:03:00.000Z",
    });
    expect(
      queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
        documentQueryKeys.plan("/repo-a", "task-1"),
      ),
    ).toEqual({
      markdown: "# New plan",
      updatedAt: "2026-02-22T10:04:00.000Z",
    });
    expect(refreshAfterLocalMutation).toHaveBeenNthCalledWith(1, "/repo-a", {
      kind: "refresh-documents",
      taskIds: ["task-1"],
    });
    expect(refreshAfterLocalMutation).toHaveBeenNthCalledWith(2, "/repo-a", {
      kind: "refresh-documents",
      taskIds: ["task-1"],
    });
  });

  test("invalidates document caches after a material document mutation", async () => {
    const { operations, queryClient } = createOperations();
    queryClient.setQueryData(documentQueryKeys.spec("/repo-a", "task-1"), {
      markdown: "# Old spec",
      updatedAt: "2026-02-22T10:00:00.000Z",
    });
    queryClient.setQueryData(["task-documents", "spec", "", "task-1"], {
      markdown: "# Other workspace spec",
      updatedAt: "2026-02-22T10:00:00.000Z",
    });

    await operations.saveSpecDocument("task-1", "# New spec");

    expect(queryClient.getQueryState(["task-documents", "spec", "", "task-1"])?.isInvalidated).toBe(
      true,
    );
  });

  test("propagates a post-commit TaskViewSync refresh failure", async () => {
    const refreshFailure = new Error("document refresh unavailable");
    const refreshAfterLocalMutation = mock(async () => {
      throw refreshFailure;
    });
    const saveSpecDocument = mock(async () => ({ updatedAt: "2026-04-10T13:10:00.000Z" }));
    const { operations } = createOperations({
      host: { saveSpecDocument },
      refreshAfterLocalMutation,
    });

    await expect(operations.saveSpecDocument("task-1", "# Saved spec")).rejects.toThrow(
      "document refresh unavailable",
    );
    expect(saveSpecDocument).toHaveBeenCalledWith({
      repoPath: "/repo-a",
      taskId: "task-1",
      markdown: "# Saved spec",
    });
  });

  test("preserves a newer cached document when a save response arrives out of order", async () => {
    const { operations, queryClient } = createOperations({
      host: {
        saveSpecDocument: mock(async () => ({ updatedAt: "2026-02-22T10:01:00.000Z" })),
        savePlanDocument: mock(async () => ({ updatedAt: "2026-02-22T10:01:00.000Z" })),
      },
    });
    queryClient.setQueryData(documentQueryKeys.spec("/repo-a", "task-1"), {
      markdown: "# Newer spec",
      updatedAt: "2026-02-22T10:05:00.000Z",
    });
    queryClient.setQueryData(documentQueryKeys.plan("/repo-a", "task-1"), {
      markdown: "# Newer plan",
      updatedAt: "2026-02-22T10:05:00.000Z",
    });

    await operations.saveSpecDocument("task-1", "# Older spec response");
    await operations.savePlanDocument("task-1", "# Older plan response");

    expect(
      queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
        documentQueryKeys.spec("/repo-a", "task-1"),
      ),
    ).toEqual({
      markdown: "# Newer spec",
      updatedAt: "2026-02-22T10:05:00.000Z",
    });
    expect(
      queryClient.getQueryData<{ markdown: string; updatedAt: string | null }>(
        documentQueryKeys.plan("/repo-a", "task-1"),
      ),
    ).toEqual({
      markdown: "# Newer plan",
      updatedAt: "2026-02-22T10:05:00.000Z",
    });
  });
});
