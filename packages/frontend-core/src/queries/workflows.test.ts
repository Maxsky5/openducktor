import { describe, expect, test } from "bun:test";
import { taskCardSchema, type TaskCard } from "@openducktor/contracts";
import { createSharedBoardWorkflows } from "@openducktor/workflows/test-support";
import { mapToKanbanColumns, type TaskWorkflow } from "@openducktor/workflows";
import { createTestClientConnection } from "../test-support/test-client-connection";
import { repoTaskDataQueryOptions } from "./tasks";
import { getProductionTaskViewSync } from "./task-view-sync";
import { boardEvent, eventCursor } from "./task-view-sync.test-support";
import { resolveTaskCards, workspaceWorkflowQueryOptions, workflowQueryKeys } from "./workflows";

const scope = { workspaceId: "repo", repoPath: "/repo" };
const removed = { workspaceId: "removed", repoPath: "/repo" };
const closed = { workspaceId: "closed", repoPath: "/repo" };

const card = (workflow: TaskWorkflow, id: string, status = "shared_review"): TaskCard => {
  const task = {
    id,
    title: id,
    description: "",
    priority: 2,
    issueType: "feature" as const,
    status,
    labels: [],
    removeWorktreeOnClose: null,
    artifactSummary: workflow.emptyArtifactSummary(),
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-02T00:00:00.000Z",
  };
  return taskCardSchema.parse({ ...task, ...workflow.project(task) });
};

const setup = () => {
  const fixture = createSharedBoardWorkflows();
  const cards = [card(fixture.alpha, "alpha-1"), card(fixture.beta, "beta-1")];
  const context = {
    hostInstanceId: fixture.catalog.hostInstanceId,
    board: structuredClone(fixture.board),
    workflows: fixture.workflows.map(({ reference }) => reference),
    newTaskWorkflow: fixture.alpha.reference,
  };
  const connection = createTestClientConnection({
    client: {
      workflowCatalogGet: async () => fixture.catalog,
      workspaceWorkflowGet: async () => context,
      tasksList: async () => cards,
    },
  });
  return { ...fixture, cards, context, connection, queryClient: connection.queryClient };
};

describe("host workflow reads in the connection task cache", () => {
  test("combines shared Review cards and preserves distinct actions, roles, artifacts, prompts, and empty columns", async () => {
    const h = setup();
    try {
      const { tasks } = await h.queryClient.fetchQuery(repoTaskDataQueryOptions(scope));
      const context = await h.queryClient.ensureQueryData(workspaceWorkflowQueryOptions(scope));
      const columns = mapToKanbanColumns(tasks, context.context.board);
      expect(columns.map(({ id }) => id)).toEqual([
        "alpha_queue",
        "beta_queue",
        "beta_work",
        "alpha_hold",
        "shared_review",
        "alpha_work",
        "beta_hold",
        "alpha_approval",
        "beta_approval",
        "shared_done",
        "alpha_shelved",
        "beta_shelved",
      ]);
      expect(columns.find(({ id }) => id === "shared_review")!.tasks.map(({ id }) => id)).toEqual([
        "alpha-1",
        "beta-1",
      ]);
      expect(columns.filter(({ tasks }) => tasks.length === 0)).toHaveLength(11);
      expect(tasks[0]!.availableActions).toContain("alpha_hold");
      expect(tasks[1]!.availableActions).not.toContain("beta_hold");
      expect(Object.keys(tasks[0]!.agentWorkflows)).toEqual(["alpha_writer", "alpha_editor"]);
      expect(Object.keys(tasks[1]!.artifactSummary)).toEqual(["beta_draft", "beta_review"]);
      const editReviewPrompt = (task: (typeof tasks)[number]) =>
        task.taskWorkflow.prompts.templates.find(({ id }) => id === "messages.edit_review")!
          .template;
      expect(editReviewPrompt(tasks[0]!)).toContain("alpha:");
      expect(editReviewPrompt(tasks[1]!)).toContain("beta:");
      expect(tasks[1]!.workflowSteps.find(({ id }) => id === "beta_signoff")!.kind).toBe("human");
      const alphaEdit = h.alpha.launchAction("alpha_edit_review");
      const betaEdit = h.beta.launchAction("beta_edit_review");
      expect(alphaEdit.startModes).toEqual(["fresh", "reuse"]);
      expect(betaEdit.startModes).toEqual(["fresh"]);
    } finally {
      await h.connection.dispose();
    }
  });

  test("resolves mutation and streamed cards through the same exact definition", async () => {
    const h = setup();
    try {
      await h.queryClient.fetchQuery(repoTaskDataQueryOptions(scope));
      const [committed] = await resolveTaskCards(h.queryClient, scope, [
        card(h.alpha, "alpha-1", "alpha_hold"),
      ]);
      const sync = getProductionTaskViewSync(h.queryClient);
      await sync.reconcileExternalEvent(boardEvent(scope, [committed!]), eventCursor());
      const data = await h.queryClient.ensureQueryData(repoTaskDataQueryOptions(scope));
      const columns = mapToKanbanColumns(data.tasks, h.board);
      expect(columns.find(({ id }) => id === "alpha_hold")!.tasks.map(({ id }) => id)).toEqual([
        "alpha-1",
      ]);
      expect(columns.find(({ id }) => id === "shared_review")!.tasks.map(({ id }) => id)).toEqual([
        "beta-1",
      ]);
      expect(data.tasks.find(({ id }) => id === "alpha-1")!.taskWorkflow.reference).toEqual(
        h.alpha.reference,
      );
    } finally {
      await h.connection.dispose();
    }
  });

  test("isolates an unavailable board during reconnect and releases closed workspace metadata", async () => {
    const h = setup();
    let unavailable = false;
    h.connection.host.client.workspaceWorkflowGet = async (path) => {
      if (unavailable && path.workspaceId === "removed") throw new Error("Workspace was removed");
      return h.context;
    };
    try {
      await Promise.all(
        [scope, removed, closed].map((path) =>
          h.queryClient.fetchQuery(repoTaskDataQueryOptions(path)),
        ),
      );
      const sync = getProductionTaskViewSync(h.queryClient);
      await sync.releaseWorkspace(closed);
      expect(h.queryClient.getQueryState(workflowQueryKeys.workspace(closed))).toBeUndefined();
      unavailable = true;
      const recovered = await sync.reconcileStreamSnapshot([scope, removed]);
      expect(
        [...recovered.taskIdsByRepo].find(([key]) => key.workspaceId === scope.workspaceId)?.[1],
      ).toEqual(["alpha-1", "beta-1"]);
      expect(
        [...recovered.failures].find(([key]) => key.workspaceId === removed.workspaceId)?.[1],
      ).toEqual(new Error("Workspace was removed"));
      expect(
        [...recovered.failures.keys()].some((key) => key.workspaceId === scope.workspaceId),
      ).toBe(false);
    } finally {
      await h.connection.dispose();
    }
  });

  test.each(["revision", "missing state", "conflict"] as const)(
    "fails clearly for an invalid host %s",
    async (failure) => {
      const h = setup();
      try {
        if (failure === "revision") h.cards[0]!.workflow.revision += 1;
        if (failure === "missing state")
          h.context.board.states = h.board.states.filter(({ id }) => id !== "shared_review");
        if (failure === "conflict")
          h.catalog.workflows[1]!.definition.states.find(
            ({ id }) => id === "shared_review",
          )!.terminal = true;
        await expect(h.queryClient.fetchQuery(repoTaskDataQueryOptions(scope))).rejects.toThrow(
          failure === "revision"
            ? "outside this workspace"
            : failure === "missing state"
              ? "missing board or workflow state"
              : "conflicts",
        );
      } finally {
        await h.connection.dispose();
      }
    },
  );
});
