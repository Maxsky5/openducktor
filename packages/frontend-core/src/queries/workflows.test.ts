import { describe, expect, test } from "bun:test";
import { taskCardSchema, type AgentRoleDefinition, type TaskCard } from "@openducktor/contracts";
import { createSharedBoardWorkflows } from "@openducktor/workflows/test-support";
import {
  createTaskWorkflow,
  mapToKanbanColumns,
  taskWorkflowDescriptor,
  type TaskWorkflow,
} from "@openducktor/workflows";
import { createTestClientConnection } from "../test-support/test-client-connection";
import { repoTaskDataQueryOptions } from "./tasks";
import { getProductionTaskViewSync } from "./task-view-sync";
import { boardEvent, eventCursor } from "./task-view-sync.test-support";
import { applyWorkflowLibraryChange } from "./workflow-library-changes";
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
    newTaskWorkflows: [fixture.alpha.reference, fixture.beta.reference],
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
        "open",
        "alpha_work",
        "beta_work",
        "alpha_hold",
        "beta_hold",
        "shared_review",
        "alpha_approval",
        "beta_approval",
        "closed",
      ]);
      expect(columns.find(({ id }) => id === "shared_review")!.tasks.map(({ id }) => id)).toEqual([
        "alpha-1",
        "beta-1",
      ]);
      expect(columns.filter(({ tasks }) => tasks.length === 0)).toHaveLength(8);
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

  test.each(["revision", "missing state", "duplicate"] as const)(
    "fails clearly for an invalid host %s",
    async (failure) => {
      const h = setup();
      try {
        if (failure === "revision") h.cards[0]!.workflow.revision += 1;
        if (failure === "missing state")
          h.context.board.states = h.board.states.filter(({ id }) => id !== "shared_review");
        if (failure === "duplicate")
          h.catalog.workflows.push(structuredClone(h.catalog.workflows[1]!));
        await expect(h.queryClient.fetchQuery(repoTaskDataQueryOptions(scope))).rejects.toThrow(
          failure === "revision"
            ? "outside this workspace"
            : failure === "missing state"
              ? "missing board or workflow state"
              : "Duplicate workflow",
        );
      } finally {
        await h.connection.dispose();
      }
    },
  );
});

/** The next published version of a workflow, compiled with the roles of the host catalog. */
const nextVersion = (
  workflow: TaskWorkflow,
  revision: number,
  roles: readonly AgentRoleDefinition[],
): TaskWorkflow => {
  const descriptor = taskWorkflowDescriptor(workflow);
  descriptor.definition.revision = revision;
  return createTaskWorkflow(descriptor.definition, descriptor.templates, roles);
};

/** A host that counts its workflow reads and can publish a new version of alpha. */
const countingSetup = () => {
  const h = setup();
  const reads = { catalog: 0, context: 0 };
  h.connection.host.client.workflowCatalogGet = async () => {
    reads.catalog += 1;
    return structuredClone(h.catalog);
  };
  h.connection.host.client.workspaceWorkflowGet = async () => {
    reads.context += 1;
    return structuredClone(h.context);
  };
  const alpha2 = nextVersion(h.alpha, 2, h.catalog.roles);
  /** Publishes alpha v2 and moves its tasks there, as the host does in one commit. */
  const publishAlpha2 = () => {
    h.catalog.workflows.push(taskWorkflowDescriptor(alpha2));
    h.context.workflows = [alpha2.reference, h.beta.reference];
    h.context.newTaskWorkflows = [alpha2.reference, h.beta.reference];
    h.context.newTaskWorkflow = alpha2.reference;
  };
  return { ...h, reads, alpha2, publishAlpha2 };
};

describe("task cards of a version that the cached workspace lacks", () => {
  test("a task frame before the library event reads the workspace and the catalog once more", async () => {
    const h = countingSetup();
    try {
      await h.queryClient.fetchQuery(repoTaskDataQueryOptions(scope));
      expect(h.reads).toEqual({ catalog: 1, context: 1 });
      h.publishAlpha2();
      const sync = getProductionTaskViewSync(h.queryClient);
      await sync.reconcileExternalEvent(
        boardEvent(scope, [card(h.alpha2, "alpha-1")]),
        eventCursor(),
      );
      const data = await h.queryClient.ensureQueryData(repoTaskDataQueryOptions(scope));
      expect(data.tasks.find(({ id }) => id === "alpha-1")!.taskWorkflow.reference).toEqual(
        h.alpha2.reference,
      );
      expect(h.reads).toEqual({ catalog: 2, context: 2 });
      // The library event that follows marks the reads stale. No view observes them here.
      await applyWorkflowLibraryChange(h.queryClient);
      expect(h.reads).toEqual({ catalog: 2, context: 2 });
    } finally {
      await h.connection.dispose();
    }
  });

  test("a task frame after the library event reads the stale workspace and catalog once", async () => {
    const h = countingSetup();
    try {
      await h.queryClient.fetchQuery(repoTaskDataQueryOptions(scope));
      h.publishAlpha2();
      await applyWorkflowLibraryChange(h.queryClient);
      const sync = getProductionTaskViewSync(h.queryClient);
      await sync.reconcileExternalEvent(
        boardEvent(scope, [card(h.alpha2, "alpha-1")]),
        eventCursor(),
      );
      const data = await h.queryClient.ensureQueryData(repoTaskDataQueryOptions(scope));
      expect(data.tasks.find(({ id }) => id === "alpha-1")!.taskWorkflow.reference).toEqual(
        h.alpha2.reference,
      );
      expect(h.reads).toEqual({ catalog: 2, context: 2 });
    } finally {
      await h.connection.dispose();
    }
  });

  test("a second miss fails with the inventory error", async () => {
    const h = countingSetup();
    try {
      await h.queryClient.fetchQuery(repoTaskDataQueryOptions(scope));
      const unknown = nextVersion(h.alpha, 3, h.catalog.roles);
      await expect(
        resolveTaskCards(h.queryClient, scope, [card(unknown, "alpha-1")]),
      ).rejects.toThrow('references workflow "alpha@3" outside this workspace');
      expect(h.reads).toEqual({ catalog: 1, context: 2 });
    } finally {
      await h.connection.dispose();
    }
  });
});

describe("a workflow that new tasks cannot use", () => {
  /**
   * Alpha is enabled; beta is disabled. The host shows the beta columns only while a beta task is
   * not closed, and counts its workspace reads.
   */
  const disabledBeta = async (betaStatus: string | null) => {
    const h = setup();
    const fullBoard = h.context.board;
    const reads = { context: 0 };
    const showBeta = (shown: boolean) => {
      h.context.board = shown
        ? fullBoard
        : { states: fullBoard.states.filter(({ id }) => !id.startsWith("beta_")) };
    };
    h.connection.host.client.workspaceWorkflowGet = async () => {
      reads.context += 1;
      return structuredClone(h.context);
    };
    h.context.newTaskWorkflows = [h.alpha.reference];
    // A null status: the closed task is outside Done retention, so no list holds it.
    if (betaStatus === null) h.cards.splice(1, 1);
    else h.cards[1] = card(h.beta, "beta-1", betaStatus);
    showBeta(betaStatus !== null && betaStatus !== "closed");
    await h.queryClient.fetchQuery(repoTaskDataQueryOptions(scope));
    const columns = () =>
      h.queryClient
        .getQueryData<{ context: typeof h.context }>(workflowQueryKeys.workspace(scope))!
        .context.board.states.map(({ id }) => id);
    const send = (cards: TaskCard[], options?: Parameters<typeof boardEvent>[2]) =>
      getProductionTaskViewSync(h.queryClient).reconcileExternalEvent(
        boardEvent(scope, cards, options),
        eventCursor(),
      );
    return { ...h, reads, showBeta, columns, send };
  };

  test("reads the board only for events of a version that new tasks cannot use", async () => {
    const h = await disabledBeta("beta_work");
    try {
      await h.send([card(h.alpha, "alpha-1", "closed")]);
      expect(h.reads.context).toBe(1);
      h.showBeta(false);
      await h.send([card(h.beta, "beta-1", "closed")]);
      expect(h.reads.context).toBe(2);
      expect(h.columns()).not.toContain("beta_work");
    } finally {
      await h.connection.dispose();
    }
  });

  test("restores the columns when a closed task reopens in a shared state", async () => {
    const h = await disabledBeta("closed");
    try {
      h.showBeta(true);
      // Reset Task moves the task to open, a column that the board already has.
      await h.send([card(h.beta, "beta-1", "open")]);
      expect(h.reads.context).toBe(2);
      expect(h.columns()).toContain("beta_work");
    } finally {
      await h.connection.dispose();
    }
  });

  test("restores the columns when no list held the reopened task", async () => {
    const h = await disabledBeta(null);
    try {
      h.showBeta(true);
      await h.send([card(h.beta, "beta-1", "open")]);
      expect(h.columns()).toContain("beta_work");
    } finally {
      await h.connection.dispose();
    }
  });

  test("reads the board before it joins a reopened task in a missing column", async () => {
    const h = await disabledBeta("closed");
    try {
      h.showBeta(true);
      await h.send([card(h.beta, "beta-1", "beta_work")]);
      const data = await h.queryClient.ensureQueryData(repoTaskDataQueryOptions(scope));
      expect(data.tasks.find(({ id }) => id === "beta-1")!.status).toBe("beta_work");
      expect(h.reads.context).toBe(2);
    } finally {
      await h.connection.dispose();
    }
  });

  test("drops the columns when its last open task is deleted", async () => {
    const h = await disabledBeta("beta_work");
    try {
      h.showBeta(false);
      await h.send([], { removedTaskIds: ["beta-1"] });
      expect(h.columns()).not.toContain("beta_work");
    } finally {
      await h.connection.dispose();
    }
  });
});
