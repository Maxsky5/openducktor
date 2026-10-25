import { describe, expect, mock, test } from "bun:test";
import type {
  FreeTaskArtifact,
  TaskArtifact,
  TaskArtifactCollection,
  TaskCard,
} from "@openducktor/contracts";
import { workflowArtifactId } from "@openducktor/contracts";
import { ClientConnectionProvider } from "@openducktor/frontend-core";
import { createTestClientConnection } from "@openducktor/frontend-core/test-support/test-client-connection";
import { artifactQueryKeys } from "@openducktor/frontend-core/queries/artifacts";
import {
  documentQueryKeys,
  loadPlanDocumentFromQuery,
  loadSpecDocumentFromQuery,
  taskDocumentQueryOptions,
  type TaskDocument,
  type TaskDocumentSection,
} from "@openducktor/frontend-core/queries/documents";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createElement, useState } from "react";
import {
  type ArtifactSelection,
  TaskArtifactsSection,
  type TaskArtifactsProps,
  TaskArtifactsView,
} from "./task-artifacts";

/** The session panel with local selection, as its page model owns it. */
function StatefulPanel(props: TaskArtifactsProps) {
  const [selection, onSelectionChange] = useState<ArtifactSelection>({ kind: "collection" });
  return createElement(TaskArtifactsView, { ...props, selection, onSelectionChange });
}

const freeArtifact = (artifactId = "file-1", name = "Notes"): FreeTaskArtifact => ({
  artifactId,
  taskId: "task-1",
  name,
  revision: 1,
  updatedAt: "2026-10-22T12:00:00Z",
  classification: "free",
  code: "test-output",
  fileName: "notes.txt",
  mediaType: "text/plain",
  byteSize: 5,
});
const content = (artifact: TaskArtifact) => ({
  artifact,
  version: "v1",
  dataBase64: "aGVsbG8=",
  byteOffset: 0,
  nextByteOffset: null,
  totalBytes: 5,
});
type SetupOptions = {
  canManageFree?: boolean;
  /** A controlled panel selection. Without it, the panel keeps its own selection. */
  selection?: ArtifactSelection;
  variant?: "panel" | "section";
  artifactSummary?: TaskCard["artifactSummary"];
  listError?: Error;
};

const setup = (
  artifacts: TaskArtifact[],
  {
    canManageFree = true,
    selection,
    variant = "panel",
    artifactSummary,
    listError,
  }: SetupOptions = {},
) => {
  const onSelectionChange = mock((_selection: ArtifactSelection) => {});
  const read = mock(async ({ artifactId }: { artifactId: string }) => {
    const artifact = artifacts.find((item) => item.artifactId === artifactId);
    if (artifact?.classification !== "free")
      throw new Error(`Unexpected free artifact ${artifactId}`);
    return content(artifact);
  });
  const readWorkflow = mock(
    async (
      _repoPath: string,
      _taskId: string,
      _section: TaskDocumentSection,
    ): Promise<TaskDocument> => ({ markdown: "hello", updatedAt: null }),
  );
  const remove = mock(async ({ artifactId }: { artifactId: string }) => {
    artifacts = artifacts.filter((item) => item.artifactId !== artifactId);
    return {
      artifactId,
      cursor: { epoch: "11111111-1111-4111-8111-111111111111", sequence: 1 },
    };
  });
  const connection = createTestClientConnection({
    client: {
      taskArtifactsList: async () => {
        if (listError) throw listError;
        return { artifacts, canManageFree };
      },
      taskArtifactRead: read,
      taskWorkflowArtifactGet: readWorkflow,
      taskArtifactDelete: remove,
    },
  });
  const ownProps: TaskArtifactsProps = { repoPath: "/repo", taskId: "task-1" };
  if (artifactSummary) ownProps.artifactSummary = artifactSummary;
  const view = render(
    createElement(
      ClientConnectionProvider,
      { connection },
      selection
        ? createElement(TaskArtifactsView, {
            repoPath: "/repo",
            taskId: "task-1",
            selection,
            onSelectionChange,
          })
        : createElement(variant === "section" ? TaskArtifactsSection : StatefulPanel, ownProps),
    ),
  );
  const select = (next: ArtifactSelection) =>
    view.rerender(
      createElement(
        ClientConnectionProvider,
        { connection },
        createElement(TaskArtifactsView, {
          repoPath: "/repo",
          taskId: "task-1",
          selection: next,
          onSelectionChange,
        }),
      ),
    );
  return { ...view, connection, read, readWorkflow, remove, onSelectionChange, select };
};

describe("task artifacts collection", () => {
  test.each([
    ["spec", loadSpecDocumentFromQuery],
    ["plan", loadPlanDocumentFromQuery],
  ] as const)(
    "a %s preview shares its fresh document with the editor",
    async (workflowKind, load) => {
      const workflow: TaskArtifact = {
        artifactId: workflowArtifactId("task-1", workflowKind),
        taskId: "task-1",
        name: "Workflow output",
        revision: 1,
        updatedAt: null,
        classification: "workflow",
        workflowKind,
        mediaType: "text/markdown",
      };
      const view = setup([workflow]);
      try {
        fireEvent.click(await screen.findByRole("button", { name: /^Workflow output / }));
        expect(await screen.findByText("hello")).toBeTruthy();
        expect(await load(view.connection.queryClient, "/repo", "task-1")).toEqual({
          markdown: "hello",
          updatedAt: null,
        });
        expect(view.read.mock.calls.length + view.readWorkflow.mock.calls.length).toBe(1);
      } finally {
        view.unmount();
        view.connection.queryClient.clear();
      }
    },
  );

  test("shows cached workflows at once while their collection is still loading", async () => {
    const workflows: TaskArtifact[] = (["spec", "plan"] as const).map((workflowKind) => ({
      artifactId: workflowArtifactId("task-1", workflowKind),
      taskId: "task-1",
      name: workflowKind === "spec" ? "Specification" : "Implementation Plan",
      revision: 1,
      updatedAt: null,
      classification: "workflow",
      workflowKind,
      mediaType: "text/markdown",
    }));
    const pendingCollection = Promise.withResolvers<TaskArtifactCollection>();
    const pendingDocument = Promise.withResolvers<TaskDocument>();
    const read = mock(
      async (
        _repoPath: string,
        _taskId: string,
        _section: TaskDocumentSection,
      ): Promise<TaskDocument> => ({ markdown: "hello", updatedAt: null }),
    );
    const connection = createTestClientConnection({
      client: {
        taskArtifactsList: () => pendingCollection.promise,
        taskWorkflowArtifactGet: read,
      },
    });
    await Promise.all(
      (["spec", "plan"] as const).map((section) =>
        connection.queryClient.fetchQuery(
          taskDocumentQueryOptions(connection.queryClient, "/repo", "task-1", section),
        ),
      ),
    );
    const artifactSummary: TaskCard["artifactSummary"] = {
      spec: { has: true },
      plan: { has: true },
      qaReport: { has: false, verdict: "not_reviewed" },
    };
    const selectedView = (workflowKind: "spec" | "plan") =>
      createElement(
        ClientConnectionProvider,
        { connection },
        createElement(TaskArtifactsView, {
          repoPath: "/repo",
          taskId: "task-1",
          artifactSummary,
          selection: { kind: "workflow", workflowKind },
          onSelectionChange: () => {},
        }),
      );
    const view = render(selectedView("spec"));
    try {
      expect(screen.getByText("hello")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Specification" })).toBeTruthy();
      expect(
        connection.queryClient.getQueryState(artifactQueryKeys.collection("/repo", "task-1"))
          ?.fetchStatus,
      ).toBe("fetching");
      view.rerender(selectedView("plan"));
      expect(screen.getByText("hello")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Implementation Plan" })).toBeTruthy();
      // Let inactive query cleanup run before returning to the other session.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      view.rerender(selectedView("spec"));
      expect(screen.queryByText("Loading artifact...")).toBeNull();
      expect(screen.getByText("hello")).toBeTruthy();
      expect(read).toHaveBeenCalledTimes(2);
      const preview = screen.getByText("hello");
      read.mockImplementationOnce(() => pendingDocument.promise);
      act(() => {
        void connection.queryClient.invalidateQueries({
          queryKey: documentQueryKeys.spec("/repo", "task-1"),
          exact: true,
        });
      });
      expect(await screen.findByText("Updating preview...")).toBeTruthy();
      expect(preview.isSameNode(screen.getByText("hello"))).toBe(true);
    } finally {
      pendingDocument.resolve({ markdown: "hello", updatedAt: null });
      pendingCollection.resolve({ artifacts: workflows, canManageFree: true });
      view.unmount();
      connection.queryClient.clear();
    }
  });

  test.each(["missing", "rejected read", "payload error"] as const)(
    "replaces a cached workflow preview with its %s result",
    async (result) => {
      const workflow: TaskArtifact = {
        artifactId: workflowArtifactId("task-1", "spec"),
        taskId: "task-1",
        name: "Specification",
        revision: 1,
        updatedAt: null,
        classification: "workflow",
        workflowKind: "spec",
        mediaType: "text/markdown",
      };
      const view = setup([workflow]);
      try {
        fireEvent.click(await screen.findByRole("button", { name: /^Specification / }));
        const preview = await screen.findByText("hello");
        expect(screen.getByRole("button", { name: "Copy artifact content" })).toBeTruthy();
        expect(screen.getByRole("button", { name: "Expand" })).toBeTruthy();
        const failure = new Error("The workflow output is unavailable.");
        view.readWorkflow.mockImplementationOnce(async () => {
          if (result === "rejected read") throw failure;
          return result === "missing"
            ? { markdown: "", updatedAt: null }
            : { markdown: "hello", updatedAt: null, error: failure.message };
        });
        await act(async () => {
          await view.connection.queryClient.invalidateQueries({
            queryKey: documentQueryKeys.spec("/repo", "task-1"),
            exact: true,
          });
        });
        if (result === "missing") {
          expect(await screen.findByText("Specification has not been created yet.")).toBeTruthy();
          expect(screen.queryByRole("alert")).toBeNull();
        } else {
          expect((await screen.findByRole("alert")).textContent).toContain(
            'Cannot read "Specification". The workflow output is unavailable.',
          );
          expect(screen.getByRole("button", { name: "Retry read" })).toBeTruthy();
        }
        expect(preview.isConnected).toBe(false);
        expect(screen.queryByRole("region", { name: "Specification preview" })).toBeNull();
        expect(screen.queryByText("hello")).toBeNull();
        expect(screen.queryByText("Loading artifact...")).toBeNull();
        expect(screen.queryByRole("button", { name: "Copy artifact content" })).toBeNull();
        expect(screen.queryByRole("button", { name: "Expand" })).toBeNull();
      } finally {
        view.unmount();
        view.connection.queryClient.clear();
      }
    },
  );

  test("selects a workflow by kind and requests the collection when navigating back", async () => {
    const workflow: TaskArtifact = {
      artifactId: "workflow:task-1:qa_report",
      taskId: "task-1",
      name: "QA Report",
      revision: 1,
      updatedAt: null,
      classification: "workflow",
      workflowKind: "qaReport",
      mediaType: "text/markdown",
    };
    const view = setup([freeArtifact(), workflow], {
      selection: { kind: "workflow", workflowKind: "qaReport" },
    });
    try {
      expect(await screen.findByText("hello")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "QA Report" })).toBeTruthy();
      expect(view.readWorkflow).toHaveBeenCalledWith("/repo", "task-1", "qa");
      expect(view.read).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "All artifacts" }));
      expect(view.onSelectionChange.mock.calls).toEqual([[{ kind: "collection" }]]);
    } finally {
      view.unmount();
      view.connection.queryClient.clear();
    }
  });

  test("uses the workflow summary before the collection to detect and read a new plan", async () => {
    const workflow: TaskArtifact = {
      artifactId: workflowArtifactId("task-1", "plan"),
      taskId: "task-1",
      name: "Implementation Plan",
      revision: 1,
      updatedAt: null,
      classification: "workflow",
      workflowKind: "plan",
      mediaType: "text/markdown",
    };
    const pendingCollection = Promise.withResolvers<TaskArtifactCollection>();
    const read = mock(
      async (_repoPath: string, _taskId: string, _section: TaskDocumentSection) => ({
        markdown: "hello",
        updatedAt: null,
      }),
    );
    const onSelectionChange = mock((_selection: ArtifactSelection) => {});
    const connection = createTestClientConnection({
      client: {
        taskArtifactsList: () => pendingCollection.promise,
        taskWorkflowArtifactGet: read,
      },
    });
    const selectedView = (hasPlan: boolean) =>
      createElement(
        ClientConnectionProvider,
        { connection },
        createElement(TaskArtifactsView, {
          repoPath: "/repo",
          taskId: "task-1",
          artifactSummary: {
            spec: { has: false },
            plan: { has: hasPlan },
            qaReport: { has: false, verdict: "not_reviewed" },
          },
          selection: { kind: "workflow", workflowKind: "plan" },
          onSelectionChange,
        }),
      );
    const view = render(selectedView(false));
    try {
      expect(screen.getByText("Implementation Plan has not been created yet.")).toBeTruthy();
      expect(read).not.toHaveBeenCalled();
      view.rerender(selectedView(true));
      expect(await screen.findByText("hello")).toBeTruthy();
      expect(screen.queryByText(/has not been created yet/)).toBeNull();
      expect(read).toHaveBeenCalledWith("/repo", "task-1", "plan");
      expect(onSelectionChange).not.toHaveBeenCalled();
    } finally {
      pendingCollection.resolve({ artifacts: [workflow], canManageFree: true });
      view.unmount();
      connection.queryClient.clear();
    }
  });

  test("keeps an absent workflow selected until its output is created", async () => {
    const view = setup([freeArtifact()], {
      selection: { kind: "workflow", workflowKind: "plan" },
    });
    try {
      expect(await screen.findByText("Implementation Plan has not been created yet.")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Implementation Plan" })).toBeTruthy();
      expect(view.readWorkflow).not.toHaveBeenCalled();
      const workflow: TaskArtifact = {
        artifactId: "imported-plan",
        taskId: "task-1",
        name: "Implementation Plan",
        revision: 1,
        updatedAt: null,
        classification: "workflow",
        workflowKind: "plan",
        mediaType: "text/markdown",
      };
      act(() =>
        view.connection.queryClient.setQueryData<TaskArtifactCollection>(
          artifactQueryKeys.collection("/repo", "task-1"),
          { artifacts: [freeArtifact(), workflow], canManageFree: true },
        ),
      );
      expect(await screen.findByText("hello")).toBeTruthy();
      expect(screen.queryByText(/has not been created yet/)).toBeNull();
      expect(view.readWorkflow).toHaveBeenCalledWith("/repo", "task-1", "plan");
      expect(view.read).not.toHaveBeenCalled();
      expect(view.onSelectionChange).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      view.connection.queryClient.clear();
    }
  });

  test("keeps the preview and scroll position during a rename and equal-byte refresh", async () => {
    const artifact = freeArtifact();
    const view = setup([artifact]);
    const pendingRead = Promise.withResolvers<ReturnType<typeof content>>();
    try {
      fireEvent.click(await screen.findByRole("button", { name: /^Notes / }));
      const preview = await screen.findByText("hello");
      const scrollContainer = preview.parentElement!;
      scrollContainer.scrollTop = 120;
      const renamed = { ...artifact, name: "Renamed notes", revision: 2 };
      view.read.mockImplementationOnce(() => pendingRead.promise);
      act(() => {
        view.connection.queryClient.setQueryData<TaskArtifactCollection>(
          artifactQueryKeys.collection("/repo", "task-1"),
          { artifacts: [renamed], canManageFree: true },
        );
        void view.connection.queryClient.invalidateQueries({
          queryKey: artifactQueryKeys.content("/repo", "task-1", artifact.artifactId),
          exact: true,
        });
      });
      expect(await screen.findByRole("heading", { name: "Renamed notes" })).toBeTruthy();
      expect(preview.isSameNode(screen.queryByText("hello"))).toBe(true);
      expect(scrollContainer.scrollTop).toBe(120);
      expect(screen.getByText("Updating preview...")).toBeTruthy();
      expect(screen.getByLabelText("Download").getAttribute("aria-disabled")).toBe("true");
      expect(screen.getByLabelText("Download").getAttribute("href")).toBeNull();
      act(() => pendingRead.resolve({ ...content(renamed), version: "v2" }));
      await waitFor(() =>
        expect(screen.getByLabelText("Download").getAttribute("aria-disabled")).toBe("false"),
      );
      expect(screen.queryByText("Updating preview...")).toBeNull();
      expect(preview.isSameNode(screen.getByText("hello"))).toBe(true);
      expect(scrollContainer.scrollTop).toBe(120);
      expect(screen.getByRole("link", { name: "Download" }).getAttribute("href")).toBeTruthy();
    } finally {
      pendingRead.resolve(content(artifact));
      view.unmount();
      view.connection.queryClient.clear();
    }
  });

  test("disposes a stale preview when the refreshed content cannot be read", async () => {
    const artifact = freeArtifact();
    const view = setup([artifact]);
    try {
      fireEvent.click(await screen.findByRole("button", { name: /^Notes / }));
      const preview = await screen.findByText("hello");
      view.read.mockImplementationOnce(async () => {
        throw new Error("The file is missing.");
      });
      await act(async () => {
        await view.connection.queryClient.invalidateQueries({
          queryKey: artifactQueryKeys.content("/repo", "task-1", artifact.artifactId),
          exact: true,
        });
      });
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(screen.getByText('Cannot read "Notes". The file is missing.')).toBeTruthy();
      expect(preview.isConnected).toBe(false);
      expect(screen.queryByText("hello")).toBeNull();
      expect(screen.queryByLabelText("Download")).toBeNull();
      expect(screen.getByRole("button", { name: "Retry read" })).toBeTruthy();
    } finally {
      view.unmount();
      view.connection.queryClient.clear();
    }
  });

  test("free Expand keeps loaded bytes while the inline preview refreshes and returns focus", async () => {
    const artifact = freeArtifact();
    const view = setup([artifact]);
    const pendingRead = Promise.withResolvers<ReturnType<typeof content>>();
    try {
      fireEvent.click(await screen.findByRole("button", { name: /^Notes / }));
      const inlinePreview = await screen.findByText("hello");
      const expand = screen.getByRole("button", { name: "Expand" });
      act(() => expand.focus());
      fireEvent.click(expand);
      const dialog = screen.getByRole("dialog", { name: "Notes" });
      expect(within(dialog).getByText("hello")).toBeTruthy();
      expect(inlinePreview.isConnected).toBe(true);
      expect(view.read).toHaveBeenCalledTimes(1);

      const revised = { ...artifact, name: "New notes", revision: 2, byteSize: 15 };
      view.read.mockImplementationOnce(() => pendingRead.promise);
      act(() => {
        view.connection.queryClient.setQueryData<TaskArtifactCollection>(
          artifactQueryKeys.collection("/repo", "task-1"),
          { artifacts: [revised], canManageFree: true },
        );
        void view.connection.queryClient.invalidateQueries({
          queryKey: artifactQueryKeys.content("/repo", "task-1", artifact.artifactId),
          exact: true,
        });
      });
      expect(await screen.findByText("Updating preview...")).toBeTruthy();
      expect(inlinePreview.isConnected).toBe(true);
      expect(within(dialog).getByText("hello")).toBeTruthy();
      act(() =>
        pendingRead.resolve({
          ...content(revised),
          version: "v2",
          dataBase64: btoa("Changed content"),
          totalBytes: 15,
        }),
      );
      expect(await screen.findByText("Changed content")).toBeTruthy();
      expect(within(dialog).getByRole("heading", { name: "Notes" })).toBeTruthy();
      expect(within(dialog).getByText("hello")).toBeTruthy();
      expect(view.read).toHaveBeenCalledTimes(2);

      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
      await waitFor(
        () => expect(document.activeElement?.getAttribute("aria-label")).toBe("Expand"),
        { timeout: 200 },
      );
      expect(document.activeElement === expand).toBe(true);
      expect(inlinePreview.isSameNode(screen.getByText("Changed content"))).toBe(true);
      fireEvent.click(expand);
      const reopened = screen.getByRole("dialog", { name: "New notes" });
      expect(within(reopened).getByText("Changed content")).toBeTruthy();
      expect(view.read).toHaveBeenCalledTimes(2);
    } finally {
      pendingRead.resolve(content(artifact));
      view.unmount();
      view.connection.queryClient.clear();
    }
  });

  test("keeps focus in the artifact flow when opening and returning to the collection", async () => {
    const view = setup([freeArtifact(), freeArtifact("file-2", "Other notes")]);
    try {
      const row = await screen.findByRole("button", { name: /^Notes / });
      act(() => row.focus());
      fireEvent.click(row);
      await screen.findByText("hello");
      const back = screen.getByRole("button", { name: "All artifacts" });
      await waitFor(() =>
        expect(document.activeElement?.getAttribute("aria-label")).toBe("All artifacts"),
      );
      fireEvent.click(back);
      await waitFor(() =>
        expect(document.activeElement?.getAttribute("data-artifact-id")).toBe("file-1"),
      );
    } finally {
      view.unmount();
      view.connection.queryClient.clear();
    }
  });

  test("reads only the selection, keeps it across other changes, and shows its deletion", async () => {
    const first = freeArtifact();
    const second = freeArtifact("file-2", "Other notes");
    const view = setup([first, second]);
    try {
      await waitFor(() => expect(screen.getByRole("button", { name: /^Notes / })).toBeTruthy());
      expect(view.read).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: /^Notes / }));
      await waitFor(() => expect(screen.getByText("hello")).toBeTruthy());
      act(() =>
        view.connection.queryClient.setQueryData<TaskArtifactCollection>(
          artifactQueryKeys.collection("/repo", "task-1"),
          { artifacts: [first, { ...second, name: "Renamed" }], canManageFree: true },
        ),
      );
      expect(screen.getByRole("heading", { name: "Notes" })).toBeTruthy();
      expect(view.read).toHaveBeenCalledTimes(1);
      act(() =>
        view.connection.queryClient.setQueryData<TaskArtifactCollection>(
          artifactQueryKeys.collection("/repo", "task-1"),
          { artifacts: [second], canManageFree: true },
        ),
      );
      await waitFor(() =>
        expect(screen.getByText(/This artifact is no longer available/)).toBeTruthy(),
      );
      fireEvent.click(screen.getByRole("button", { name: "All artifacts" }));
      expect(screen.getByRole("button", { name: /^Other notes / })).toBeTruthy();
    } finally {
      view.unmount();
      view.connection.queryClient.clear();
    }
  });

  test("requires named confirmation before deletion and removes the selected item", async () => {
    const view = setup([freeArtifact()]);
    try {
      fireEvent.click(await screen.findByRole("button", { name: /^Notes / }));
      fireEvent.click(await screen.findByRole("button", { name: "Artifact actions" }));
      fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
      expect(screen.getByText("Delete this artifact? This cannot be undone.")).toBeTruthy();
      expect(screen.getByRole("dialog").textContent).toContain("Notes");
      expect(view.remove).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("button", { name: "Delete artifact" }));
      await waitFor(() => expect(view.remove).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByText(/This artifact is no longer available/)).toBeTruthy(),
      );
    } finally {
      view.unmount();
      view.connection.queryClient.clear();
    }
  });

  test.each(["text/plain", "text/markdown", "image/png", "application/pdf"])(
    "a closed task expands its %s preview and hides free mutation controls",
    async (mediaType) => {
      const artifact = {
        ...freeArtifact(),
        mediaType,
        byteSize: mediaType === "image/png" ? 68 : 5,
      };
      const view = setup([artifact], { canManageFree: false });
      if (mediaType === "image/png") {
        view.read.mockImplementationOnce(async () => ({
          ...content(artifact),
          dataBase64:
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZFAAAAAASUVORK5CYII=",
          totalBytes: 68,
        }));
      }
      try {
        fireEvent.click(await screen.findByRole("button", { name: /^Notes / }));
        const expand = await screen.findByRole("button", { name: "Expand" });
        expect(screen.getByRole("link", { name: "Download" })).toBeTruthy();
        for (const name of ["Add artifact", "Rename", "Replace content", "Delete"])
          expect(screen.queryByRole("button", { name })).toBeNull();
        expect(screen.getByText(/Free artifacts are read-only/)).toBeTruthy();
        fireEvent.click(expand);
        const dialog = screen.getByRole("dialog", { name: "Notes" });
        if (mediaType === "image/png") {
          expect(await within(dialog).findByRole("img", { name: "Notes" })).toBeTruthy();
        } else if (mediaType === "application/pdf") {
          expect(
            within(dialog).getByText(/No preview is available for application\/pdf/),
          ).toBeTruthy();
        } else {
          expect(within(dialog).getByText("hello")).toBeTruthy();
        }
        expect(view.read).toHaveBeenCalledTimes(1);
      } finally {
        view.unmount();
        view.connection.queryClient.clear();
      }
    },
  );
  test("workflow Expand keeps its snapshot, hides free controls, and returns focus on close", async () => {
    const workflow: TaskArtifact = {
      artifactId: "workflow:task-1:spec",
      taskId: "task-1",
      name: "Specification",
      revision: 1,
      updatedAt: null,
      classification: "workflow",
      workflowKind: "spec",
      mediaType: "text/markdown",
    };
    const view = setup([workflow]);
    try {
      fireEvent.click(await screen.findByRole("button", { name: /^Specification / }));
      const expand = await screen.findByRole("button", { name: "Expand" });
      act(() => expand.focus());
      fireEvent.click(expand);
      expect(screen.getByRole("dialog").textContent).toContain("hello");
      act(() => {
        view.connection.queryClient.setQueryData(documentQueryKeys.spec("/repo", "task-1"), {
          markdown: "Changed content",
          updatedAt: "2026-10-22T13:00:00Z",
        });
      });
      await waitFor(() => expect(screen.getByText("Changed content")).toBeTruthy());
      expect(screen.getByRole("dialog").textContent).toContain("hello");
      expect(screen.queryByRole("link", { name: "Download" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Replace content" })).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() =>
        expect(document.activeElement?.getAttribute("aria-label")).toBe("Expand"),
      );
    } finally {
      view.unmount();
      view.connection.queryClient.clear();
    }
  });

  describe("section layout", () => {
    const toggle = () => screen.getByRole("button", { name: /^Artifacts/ });

    test("opens with a count when the task has artifacts", async () => {
      const view = setup([freeArtifact(), freeArtifact("file-2", "Other notes")], {
        variant: "section",
      });
      try {
        expect(await within(toggle()).findByText("2")).toBeTruthy();
        expect(toggle().getAttribute("aria-expanded")).toBe("true");
      } finally {
        view.unmount();
        view.connection.queryClient.clear();
      }
    });

    test("opens from the workflow summary before the list loads", () => {
      const view = setup([], {
        variant: "section",
        artifactSummary: {
          spec: { has: true },
          plan: { has: false },
          qaReport: { has: false, verdict: "not_reviewed" },
        },
      });
      try {
        expect(toggle().getAttribute("aria-expanded")).toBe("true");
      } finally {
        view.unmount();
        view.connection.queryClient.clear();
      }
    });

    test("stays collapsed without artifacts, and Add artifact does not toggle it", async () => {
      const view = setup([], { variant: "section" });
      try {
        const header = toggle();
        fireEvent.click(await screen.findByRole("button", { name: "Add artifact" }));
        expect(await screen.findByRole("dialog", { name: "Add artifact" })).toBeTruthy();
        expect(header.getAttribute("aria-expanded")).toBe("false");
      } finally {
        view.unmount();
        view.connection.queryClient.clear();
      }
    });

    test("keeps focus in the artifact flow when opening and returning to the list", async () => {
      const view = setup([freeArtifact(), freeArtifact("file-2", "Other notes")], {
        variant: "section",
      });
      try {
        const row = await screen.findByRole("button", { name: /^Notes / });
        act(() => row.focus());
        fireEvent.click(row);
        expect(await screen.findByText("hello")).toBeTruthy();
        await waitFor(() =>
          expect(document.activeElement?.getAttribute("aria-label")).toBe("All artifacts"),
        );
        fireEvent.click(screen.getByRole("button", { name: "All artifacts" }));
        await waitFor(() =>
          expect(document.activeElement?.getAttribute("data-artifact-id")).toBe("file-1"),
        );
      } finally {
        view.unmount();
        view.connection.queryClient.clear();
      }
    });

    test("shows a one-line empty state and no Add artifact on a closed task", async () => {
      const view = setup([], { canManageFree: false, variant: "section" });
      try {
        fireEvent.click(toggle());
        expect(toggle().getAttribute("aria-expanded")).toBe("true");
        expect(await screen.findByText("No artifacts yet.")).toBeTruthy();
        expect(screen.getByText("This task is closed. Free artifacts are read-only.")).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Add artifact" })).toBeNull();
      } finally {
        view.unmount();
        view.connection.queryClient.clear();
      }
    });

    test("opens the card to show a failed read and its retry", async () => {
      const view = setup([], { variant: "section", listError: new Error("Disk is offline.") });
      try {
        expect((await screen.findByRole("alert")).textContent).toContain("Disk is offline.");
        expect(toggle().getAttribute("aria-expanded")).toBe("true");
        expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
      } finally {
        view.unmount();
        view.connection.queryClient.clear();
      }
    });
  });
});
