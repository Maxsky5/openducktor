import {
  GITHUB_PROVIDER_DESCRIPTOR,
  type RepositoryGitProviderContext,
  type TaskApprovalContext,
  type TaskCard,
  type TaskAssetDescriptionMutation,
  type TaskCreateInput,
  type TaskEventCursor,
  type TaskEventStatusChange,
  type TaskRecordData,
  taskCardSchema,
  taskRecordDataSchema,
  type WorkflowTaskArtifact,
  workflowArtifactId,
} from "@openducktor/contracts";
import type { DemoHandlers, DemoHostResults } from "./demo-host-client";
import type { DemoDocumentSaveOptions } from "./demo-runs";
import type { DemoTerminals } from "./demo-terminals";
import {
  availableTaskActions,
  SPEC_PLAN_BUILD_BOARD,
  specPlanBuildWorkflow,
  taskWorkflowDescriptor,
  workflowRoleCatalog,
} from "@openducktor/workflows";
import {
  DEMO_HOST_INSTANCE_ID,
  type DemoDocument,
  type DemoDocumentCode,
  type DemoTask,
  type DemoWorkspace,
  type DemoWorld,
  demoUuid,
  findTask,
  findWorkspace,
} from "./demo-world";

const workflow = specPlanBuildWorkflow;

/** Closed tasks stay on the board this many days, as the default host setting. */
export const DEMO_DONE_VISIBLE_DAYS = 7;

const DOCUMENT_CODES = ["spec", "plan", "qaReport"] as const satisfies readonly DemoDocumentCode[];

const DOCUMENT_NAMES = {
  spec: "Specification",
  plan: "Implementation Plan",
  qaReport: "QA Report",
} as const satisfies Record<DemoDocumentCode, string>;

const isDocumentCode = (code: string): code is DemoDocumentCode =>
  code === "spec" || code === "plan" || code === "qaReport";

/** A saved document as the host sends it. The client reads this wire shape. */
const documentResult = (
  saved: DemoDocument | undefined,
): DemoHostResults["workflowArtifactGet"] => {
  if (!saved) return { markdown: "" };
  const result: DemoHostResults["workflowArtifactGet"] = {
    markdown: saved.markdown,
    updatedAt: saved.updatedAt,
    revision: saved.revision,
  };
  if (saved.verdict) result.verdict = saved.verdict;
  return result;
};

/** The task card of a stored task, as the host builds it: the workflow projection of the task. */
const taskCard = (task: DemoTask): TaskCard => {
  const projection = workflow.project(task.record);
  return taskCardSchema.parse({
    ...task.record,
    ...structuredClone(projection),
    availableActions: availableTaskActions(workflow, task.record, [...projection.availableActions]),
  });
};

/** A new stored task from its fields. */
export const taskRecord = (
  fields: Pick<TaskRecordData, "id" | "title" | "issueType" | "status"> &
    Partial<Omit<TaskRecordData, "id" | "title" | "issueType" | "status">>,
): TaskRecordData =>
  taskRecordDataSchema.parse({ artifactSummary: workflow.emptyArtifactSummary(), ...fields });

const snapshotOf = (task: DemoTask) => ({
  id: task.record.id,
  title: task.record.title,
  status: task.record.status,
  workflow: workflow.reference,
});

export type DemoTaskStore = ReturnType<typeof createDemoTaskStore>;

/** The tasks of the demo workspaces and the task commands of the host client. */
export const createDemoTaskStore = (
  world: DemoWorld,
  terminals: Pick<DemoTerminals, "closeTaskTerminals">,
) => {
  const { clock, events } = world;
  let eventNumber = 1;
  /** Staged images that a saved description uses stay until the demo ends. */
  const keptAssets = new Set<string>();
  const keepAssets = (assetIds: readonly string[]) => {
    for (const assetId of assetIds) keptAssets.add(assetId);
  };

  /** Publishes committed task changes to every task view, as the host task stream does. */
  const publish = (
    workspace: DemoWorkspace,
    change: {
      taskIds: string[];
      removedTaskIds?: string[];
      statusChanges?: TaskEventStatusChange[];
      artifactCodes?: Map<string, string[]>;
    },
  ): TaskEventCursor => {
    const removed = change.removedTaskIds ?? [];
    const removedIds = new Set(removed);
    const changed = change.taskIds
      .filter((id) => !removedIds.has(id))
      .map((id) => findTask(workspace, id));
    return events.taskChanged({
      kind: "tasks_updated",
      eventId: demoUuid(0x7a5c00000 + eventNumber++),
      workspaceId: workspace.record.workspaceId,
      repoPath: workspace.record.repoPath,
      taskIds: change.taskIds,
      removedTaskIds: removed,
      taskSnapshots: changed.map(snapshotOf),
      statusChanges: change.statusChanges ?? [],
      boardChanges: {
        cards: changed.map(taskCard),
        doneVisibleDays: DEMO_DONE_VISIBLE_DAYS,
        artifactChanges: [...(change.artifactCodes ?? new Map<string, string[]>()).entries()].map(
          ([taskId, codes]) => ({
            taskId,
            artifactIds: codes.map((code) => workflowArtifactId(taskId, code)),
            removedArtifactIds: [],
          }),
        ),
      },
      emittedAt: clock.nowIso(),
    });
  };

  const touch = (task: DemoTask, patch: Partial<TaskRecordData>) => {
    task.record = taskRecordDataSchema.parse({
      ...task.record,
      ...patch,
      updatedAt: clock.nowIso(),
    });
  };

  /**
   * Applies a workflow event as the host commits it. Throws the workflow reason when the event is
   * not available now.
   */
  const applyEvent = (
    workspace: DemoWorkspace,
    taskId: string,
    eventId: string,
    extra?: { artifactCodes?: string[] },
  ): TaskEventCursor => {
    const task = findTask(workspace, taskId);
    const decision = workflow.decide(eventId, task.record);
    if (decision.kind === "denied") {
      throw new Error(
        decision.guardMessage ??
          `This action is not available while the task is ${task.record.status}. Refresh the task.`,
      );
    }
    const statusChanges: TaskEventStatusChange[] = [];
    if (decision.kind === "transition") {
      touch(task, { status: decision.to });
      const statusChange: TaskEventStatusChange = {
        previousStatus: decision.from,
        task: snapshotOf(task),
      };
      if (decision.cause.sourceRole) statusChange.sourceRole = decision.cause.sourceRole;
      statusChanges.push(statusChange);
    } else {
      touch(task, {});
    }
    if (workflow.eventEffects(eventId).includes("worktree.reset")) resetWorktree(workspace, task);
    const change: Parameters<typeof publish>[1] = { taskIds: [taskId], statusChanges };
    if (extra?.artifactCodes) change.artifactCodes = new Map([[taskId, extra.artifactCodes]]);
    return publish(workspace, change);
  };

  /**
   * An implementation reset keeps the worktree and its branch, restores its files to the target
   * branch, and drops the review documents, the worktree role sessions, and the pull request link.
   */
  const resetWorktree = (workspace: DemoWorkspace, task: DemoTask) => {
    for (const code of workflow.reviewArtifactCodes) {
      if (isDocumentCode(code)) delete task.documents[code];
    }
    touch(task, {
      artifactSummary: {
        ...task.record.artifactSummary,
        ...Object.fromEntries(
          workflow.reviewArtifactCodes.map((code: string) => [code, { present: false }]),
        ),
      },
    });
    if (task.worktree)
      workspace.repository.resetBranch(
        workspace.repository.checkout(task.worktree.workingDirectory),
      );
    world.sessions.forgetTaskSessions(workspace, task.record.id, workflow.worktreeRoles);
    unlinkPullRequest(task);
  };

  const unlinkPullRequest = (task: DemoTask) => {
    const { pullRequest: _unlinked, ...record } = task.record;
    task.record = record;
    delete task.pullRequestDraft;
  };

  /** Saves a workflow document, and applies its submit event when `submit` is true. */
  const saveDocument = (
    workspace: DemoWorkspace,
    taskId: string,
    code: DemoDocumentCode,
    markdown: string,
    options: DemoDocumentSaveOptions,
  ) => {
    const task = findTask(workspace, taskId);
    const updatedAt = clock.nowIso();
    const document: DemoDocument = {
      markdown,
      updatedAt,
      revision: (task.documents[code]?.revision ?? 0) + 1,
    };
    if (options.verdict) document.verdict = options.verdict;
    task.documents[code] = document;
    touch(task, {
      artifactSummary: {
        ...task.record.artifactSummary,
        [code]: options.verdict
          ? { present: true, verdict: options.verdict, updatedAt }
          : { present: true, updatedAt },
      },
    });
    const submitEvent = options.submit
      ? workflow.artifactSubmitEvent(code, options.verdict)
      : undefined;
    const cursor = submitEvent
      ? applyEvent(workspace, taskId, submitEvent, { artifactCodes: [code] })
      : publish(workspace, { taskIds: [taskId], artifactCodes: new Map([[taskId, [code]]]) });
    return { updatedAt, cursor };
  };

  /** The worktree of a task, created on first use on a new branch. */
  const ensureWorktree = (workspace: DemoWorkspace, taskId: string) => {
    const task = findTask(workspace, taskId);
    if (task.worktree)
      return {
        created: false,
        checkout: workspace.repository.checkout(task.worktree.workingDirectory),
      };
    const slug = task.record.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 32);
    const worktree = {
      workingDirectory: `${workspace.worktreeRoot}/${taskId}`,
      branch: `odt/${taskId}-${slug}`,
    };
    task.worktree = worktree;
    return { created: true, checkout: workspace.repository.addWorktree(worktree) };
  };

  const linkPullRequest = (
    workspace: DemoWorkspace,
    taskId: string,
    title: string,
    body: string,
  ) => {
    const task = findTask(workspace, taskId);
    const now = clock.nowIso();
    const number = task.record.pullRequest?.number ?? world.nextPullRequestNumber++;
    touch(task, {
      pullRequest: {
        providerId: "github",
        number,
        url: `https://github.com/fieldnotes-demo/${workspace.record.workspaceId}/pull/${number}`,
        state: "open",
        createdAt: task.record.pullRequest?.createdAt ?? now,
        updatedAt: now,
      },
    });
    task.pullRequestDraft = { title, body };
    publish(workspace, { taskIds: [taskId] });
    if (!task.record.pullRequest) throw new Error("The demo pull request did not save.");
    return task.record.pullRequest;
  };

  const providerContext = (workspace: DemoWorkspace): RepositoryGitProviderContext => ({
    descriptor: GITHUB_PROVIDER_DESCRIPTOR,
    config: {
      id: "github",
      enabled: true,
      repository: {
        host: "github.com",
        owner: "fieldnotes-demo",
        name: workspace.record.workspaceId,
      },
      autoDetected: true,
    },
    health: {
      providerId: "github",
      enabled: true,
      available: true,
      executablePath: "/usr/local/bin/gh",
      version: "2.80.0",
      authenticated: true,
      account: "fieldnotes-demo",
      repositoryMappingValid: true,
    },
  });

  const workspaceOf = (scope: { workspaceId: string }) => findWorkspace(world, scope.workspaceId);

  const createTask = (
    scope: { workspaceId: string },
    input: TaskCreateInput,
    descriptionAssets?: TaskAssetDescriptionMutation,
  ): TaskCard => {
    const workspace = workspaceOf(scope);
    const prefix = workspace.record.workspaceId.slice(0, 10);
    let number = workspace.tasks.size + 1;
    while (workspace.tasks.has(`${prefix}-d${number}`)) number += 1;
    const id = `${prefix}-d${number}`;
    const now = clock.nowIso();
    const task: DemoTask = {
      record: taskRecord({
        id,
        title: input.title.trim(),
        issueType: input.issueType,
        status: "open",
        priority: input.priority,
        description: input.description ?? "",
        labels: input.labels ?? [],
        removeWorktreeOnClose: input.removeWorktreeOnClose ?? null,
        createdAt: now,
        updatedAt: now,
      }),
      documents: {},
      freeArtifacts: [],
      worktree: null,
    };
    keepAssets(descriptionAssets?.stagedAssetIds ?? []);
    workspace.tasks.set(id, task);
    events.taskChanged({
      kind: "external_task_created",
      eventId: demoUuid(0x7a5c00000 + eventNumber++),
      workspaceId: workspace.record.workspaceId,
      repoPath: workspace.record.repoPath,
      taskId: id,
      taskSnapshot: snapshotOf(task),
      boardChanges: {
        cards: [taskCard(task)],
        doneVisibleDays: DEMO_DONE_VISIBLE_DAYS,
        artifactChanges: [],
      },
      emittedAt: now,
    });
    return taskCard(task);
  };

  const listArtifacts = (workspaceId: string, taskId: string) => {
    const task = findTask(findWorkspace(world, workspaceId), taskId);
    const documents = DOCUMENT_CODES.flatMap((code) => {
      const saved = task.documents[code];
      if (!saved) return [];
      const artifact: WorkflowTaskArtifact = {
        artifactId: workflowArtifactId(taskId, code),
        taskId,
        name: DOCUMENT_NAMES[code],
        revision: saved.revision,
        updatedAt: saved.updatedAt,
        classification: "workflow",
        code,
        mediaType: "text/markdown",
      };
      if (saved.verdict) artifact.verdict = saved.verdict;
      return [artifact];
    });
    const free = task.freeArtifacts.map((artifact) => ({
      artifactId: `free:${taskId}:${artifact.code}`,
      taskId,
      name: artifact.name,
      revision: 1,
      updatedAt: artifact.updatedAt,
      classification: "free" as const,
      code: artifact.code,
      fileName: artifact.fileName,
      mediaType: artifact.mediaType,
      byteSize: decodedSize(artifact.base64),
    }));
    return { artifacts: [...documents, ...free], canManageFree: false };
  };

  const handlers = {
    workflowCatalogGet: async () => ({
      hostInstanceId: DEMO_HOST_INSTANCE_ID,
      roles: [...workflowRoleCatalog([workflow])],
      workflows: [taskWorkflowDescriptor(workflow)],
    }),
    workspaceWorkflowGet: async () => ({
      hostInstanceId: DEMO_HOST_INSTANCE_ID,
      board: SPEC_PLAN_BUILD_BOARD,
      workflows: [workflow.reference],
      newTaskWorkflow: workflow.reference,
    }),
    tasksList: async (scope) => {
      const cutoff = clock.now() - DEMO_DONE_VISIBLE_DAYS * 86_400_000;
      return [...workspaceOf(scope).tasks.values()]
        .filter(
          (task) => task.record.status !== "closed" || Date.parse(task.record.updatedAt) >= cutoff,
        )
        .map(taskCard);
    },
    tasksListAll: async (scope) => [...workspaceOf(scope).tasks.values()].map(taskCard),
    taskIdsList: async (scope) => [...workspaceOf(scope).tasks.keys()],
    taskCreate: async (scope, input, descriptionAssets) =>
      createTask(scope, input, descriptionAssets),
    taskUpdate: async (scope, taskId, patch, descriptionAssets) => {
      const workspace = workspaceOf(scope);
      const task = findTask(workspace, taskId);
      const next: Partial<TaskRecordData> = {};
      if (patch.title !== undefined) next.title = patch.title.trim();
      if (patch.description !== undefined) next.description = patch.description;
      if (patch.priority !== undefined) next.priority = patch.priority;
      if (patch.issueType !== undefined) next.issueType = patch.issueType;
      if (patch.labels !== undefined) next.labels = patch.labels;
      if (patch.targetBranch !== undefined) next.targetBranch = patch.targetBranch;
      if (patch.removeWorktreeOnClose !== undefined)
        next.removeWorktreeOnClose = patch.removeWorktreeOnClose;
      keepAssets(descriptionAssets?.stagedAssetIds ?? []);
      touch(task, next);
      publish(workspace, { taskIds: [taskId] });
      return taskCard(task);
    },
    taskDelete: async (scope, taskId) => {
      const workspace = workspaceOf(scope);
      const task = findTask(workspace, taskId);
      world.sessions.forgetTaskSessions(workspace, taskId);
      terminals.closeTaskTerminals(scope.workspaceId, taskId);
      if (task.worktree) workspace.repository.removeWorktree(task.worktree.workingDirectory);
      workspace.tasks.delete(taskId);
      // The issue of a deleted task can be imported again.
      for (const issue of workspace.issues) {
        if (issue.linkedTaskId === taskId) delete issue.linkedTaskId;
      }
      publish(workspace, { taskIds: [taskId], removedTaskIds: [taskId] });
      return { ok: true };
    },
    taskClose: async (scope, taskId, removeWorktree) => {
      const workspace = workspaceOf(scope);
      const task = findTask(workspace, taskId);
      world.sessions.stopTaskSessions(workspace, taskId);
      terminals.closeTaskTerminals(scope.workspaceId, taskId);
      const previousStatus = task.record.status;
      touch(task, { status: "closed" });
      if (removeWorktree && task.worktree) {
        workspace.repository.removeWorktree(task.worktree.workingDirectory);
        task.worktree = null;
      }
      publish(workspace, {
        taskIds: [taskId],
        statusChanges: [{ previousStatus, task: snapshotOf(task) }],
      });
      return taskCard(task);
    },
    taskReset: async (scope, taskId) => {
      const workspace = workspaceOf(scope);
      const task = findTask(workspace, taskId);
      world.sessions.forgetTaskSessions(workspace, taskId);
      terminals.closeTaskTerminals(scope.workspaceId, taskId);
      const previousStatus = task.record.status;
      task.documents = {};
      task.freeArtifacts = [];
      if (task.worktree) workspace.repository.removeWorktree(task.worktree.workingDirectory);
      task.worktree = null;
      touch(task, {
        status: "open",
        artifactSummary: workflow.emptyArtifactSummary(),
      });
      delete task.record.pullRequest;
      delete task.record.directMerge;
      publish(workspace, {
        taskIds: [taskId],
        statusChanges:
          previousStatus === "open" ? [] : [{ previousStatus, task: snapshotOf(task) }],
      });
      return taskCard(task);
    },
    taskApplyEvent: async (scope, taskId, eventId) => {
      const workspace = workspaceOf(scope);
      if (workflow.eventEffects(eventId).includes("worktree.reset"))
        world.sessions.stopTaskSessions(workspace, taskId);
      applyEvent(workspace, taskId, eventId);
      return taskCard(findTask(workspace, taskId));
    },
    taskMetadataGet: async (scope, taskId) => {
      const workspace = workspaceOf(scope);
      const task = findTask(workspace, taskId);
      return {
        artifacts: {
          spec: documentResult(task.documents.spec),
          plan: documentResult(task.documents.plan),
          qaReport: documentResult(task.documents.qaReport),
        },
        agentSessions: world.sessions.taskSessionRecords(workspace, taskId),
      };
    },
    workflowArtifactGet: async (scope, taskId, code) => {
      const task = findTask(workspaceOf(scope), taskId);
      return documentResult(isDocumentCode(code) ? task.documents[code] : undefined);
    },
    workflowArtifactSave: async (input) => {
      if (!isDocumentCode(input.code))
        throw new Error(`The demo has no document ${input.code}. Refresh the task.`);
      const verdict =
        input.verdict === "approved" || input.verdict === "rejected" ? input.verdict : undefined;
      const options: DemoDocumentSaveOptions = { submit: input.submit };
      if (verdict) options.verdict = verdict;
      return saveDocument(
        findWorkspace(world, input.workspaceId),
        input.taskId,
        input.code,
        input.markdown,
        options,
      );
    },
    taskArtifactsList: async ({ workspaceId, taskId }) => listArtifacts(workspaceId, taskId),
    taskArtifactRead: async ({ workspaceId, taskId, artifactId }) => {
      const task = findTask(findWorkspace(world, workspaceId), taskId);
      const list = listArtifacts(workspaceId, taskId);
      const artifact = list.artifacts.find((item) => item.artifactId === artifactId);
      if (!artifact)
        throw new Error("This artifact is no longer in the demo task. Refresh the list.");
      if (artifact.classification === "workflow") {
        const saved = isDocumentCode(artifact.code) ? task.documents[artifact.code] : undefined;
        return { artifact, dataBase64: toBase64(saved?.markdown ?? "") };
      }
      const free = task.freeArtifacts.find((item) => item.code === artifact.code);
      return { artifact, dataBase64: free?.base64 ?? "" };
    },
    taskAssetStage: async (input) => {
      const assetId = demoUuid(0xa55e70000 + world.nextNumber());
      world.resources.set(`asset:${assetId}`, {
        mime: input.declaredMediaType,
        base64: input.bytesBase64,
      });
      return {
        assetId,
        scope: input.scope,
        originalName: input.originalName,
        verifiedMediaType: input.declaredMediaType,
        byteSize: decodedSize(input.bytesBase64),
      };
    },
    taskAssetDiscardStaged: async ({ assetIds }) => {
      for (const assetId of assetIds) {
        if (!keptAssets.has(assetId)) world.resources.delete(`asset:${assetId}`);
      }
    },
    taskWorktreeGet: async (scope, taskId) => {
      const task = findTask(workspaceOf(scope), taskId);
      return task.worktree ? { workingDirectory: task.worktree.workingDirectory } : null;
    },
    taskWorktreeRemove: async (scope, taskId) => {
      const workspace = workspaceOf(scope);
      const task = findTask(workspace, taskId);
      if (task.worktree) workspace.repository.removeWorktree(task.worktree.workingDirectory);
      task.worktree = null;
    },
    // Chats that work in a task worktree block its removal, as on a host.
    taskWorktreeOwnersGet: async ({ workspaceId, taskIds }) => {
      const workspace = findWorkspace(world, workspaceId);
      const chats = taskIds.flatMap((taskId) => {
        const folder = findTask(workspace, taskId).worktree?.workingDirectory;
        if (!folder) return [];
        return world.sessions
          .chatsInFolder(workspace, folder)
          .map((chat) => ({ workspaceId, sessionId: chat.sessionId, title: chat.title }));
      });
      return {
        owners: { checkoutWorkspaces: [], tasks: [], chats, historyChats: [] },
        historyReadErrors: [],
      };
    },
    taskWorktreeCleanupImpactGet: async (scope, taskId) => {
      const workspace = workspaceOf(scope);
      const task = findTask(workspace, taskId);
      if (!task.worktree)
        return {
          worktreePaths: [],
          branchNames: [],
          uncommittedFileCount: 0,
          mergeCandidate: false,
          branchOid: null,
        };
      const checkout = workspace.repository.checkout(task.worktree.workingDirectory);
      return {
        worktreePaths: [task.worktree.workingDirectory],
        branchNames: [task.worktree.branch],
        uncommittedFileCount: checkout.uncommitted.size,
        mergeCandidate: false,
        branchOid: checkout.revision,
      };
    },
    taskStopImpactGet: async (scope, taskIds) => ({
      stoppableSessionCount: taskIds.reduce(
        (count, taskId) =>
          count + world.sessions.runningTaskSessionCount(workspaceOf(scope), taskId),
        0,
      ),
    }),
    taskMergeStatusGet: async (scope) => ({
      workspaceId: scope.workspaceId,
      repoPath: scope.repoPath,
      tasks: [],
      autoCloseFailures: [],
    }),
    taskMergeStatusCheck: async (scope) => ({
      workspaceId: scope.workspaceId,
      repoPath: scope.repoPath,
      tasks: [],
      autoCloseFailures: [],
    }),
    autopilotStateRead: async () => ({ outcomes: [], failure: null }),
    workspaceGetGitProviderContext: async (scope) => providerContext(workspaceOf(scope)),
    taskApprovalContextGet: async (scope, taskId) => {
      const workspace = workspaceOf(scope);
      const task = findTask(workspace, taskId);
      if (!task.worktree)
        return { outcome: "missing_worktree", taskId, taskStatus: task.record.status };
      const checkout = workspace.repository.checkout(task.worktree.workingDirectory);
      const approvalContext: TaskApprovalContext = {
        taskId,
        taskStatus: task.record.status,
        workingDirectory: task.worktree.workingDirectory,
        sourceBranch: task.worktree.branch,
        targetBranch: task.record.targetBranch ?? workspace.defaultTargetBranch,
        defaultMergeMethod: "squash",
        hasUncommittedChanges: checkout.uncommitted.size > 0,
        uncommittedFileCount: checkout.uncommitted.size,
        suggestedSquashCommitMessage: task.record.title,
      };
      if (task.record.pullRequest) approvalContext.pullRequest = task.record.pullRequest;
      return { outcome: "ready", approvalContext };
    },
    taskDirectMerge: async (scope, taskId, input) => {
      const workspace = workspaceOf(scope);
      const task = findTask(workspace, taskId);
      if (!task.worktree)
        throw new Error("This task has no worktree to merge. Refresh the task, then try again.");
      world.sessions.stopTaskSessions(workspace, taskId);
      workspace.repository.mergeInto(
        workspace.repository.checkout(task.worktree.workingDirectory),
        input.expected.targetBranch.branch,
      );
      if (input.removeWorktree) {
        workspace.repository.removeWorktree(task.worktree.workingDirectory);
        task.worktree = null;
      }
      // The demo repository has no publish target, so the merge closes the task at once.
      const previousStatus = task.record.status;
      touch(task, { status: "closed" });
      publish(workspace, {
        taskIds: [taskId],
        statusChanges: [{ previousStatus, task: snapshotOf(task) }],
      });
      return { outcome: "completed", task: taskCard(task) };
    },
    taskPullRequestUpsert: async (scope, taskId, title, body) =>
      linkPullRequest(workspaceOf(scope), taskId, title, body),
    taskPullRequestUnlink: async (scope, taskId) => {
      const workspace = workspaceOf(scope);
      const task = findTask(workspace, taskId);
      if (!task.record.pullRequest) return false;
      unlinkPullRequest(task);
      touch(task, {});
      publish(workspace, { taskIds: [taskId] });
      return true;
    },
    taskPullRequestDetect: async (scope, taskId) => {
      const task = findTask(workspaceOf(scope), taskId);
      if (task.record.pullRequest)
        return { outcome: "linked", pullRequest: task.record.pullRequest };
      return {
        outcome: "not_found",
        sourceBranch: task.worktree?.branch ?? "main",
        targetBranch: workspaceOf(scope).defaultTargetBranch.branch,
      };
    },
    pullRequestReviewContextGet: async ({ workspaceId, taskId }) => {
      const task = taskId ? findTask(findWorkspace(world, workspaceId), taskId) : null;
      const pullRequest = task?.record.pullRequest;
      if (!task || !pullRequest)
        return {
          status: "no_pull_request",
          providerId: "github",
          reason: "This task has no pull request yet.",
        };
      const finished = clock.agoIso(4 * 60_000);
      const check = (name: string, workflowName: string, minutes: number) => ({
        name,
        workflow: workflowName,
        status: "completed" as const,
        conclusion: "success" as const,
        url: null,
        details: null,
        startedAt: clock.agoIso((minutes + 4) * 60_000),
        completedAt: finished,
      });
      return {
        status: "loaded",
        providerId: "github",
        pullRequest: {
          providerId: "github",
          number: pullRequest.number,
          title: task.pullRequestDraft?.title ?? task.record.title,
          url: pullRequest.url,
          state: "open",
        },
        aggregateStatus: "success",
        checks: [check("Typecheck", "CI", 2), check("Unit tests", "CI", 3), check("Lint", "CI", 1)],
        comments: [],
        reviewThreads: { openCount: 0 },
        refreshedAt: clock.nowIso(),
      };
    },
    issueItemsList: async ({ workspaceId, search }) => {
      const query = search.trim().toLowerCase();
      const items = findWorkspace(world, workspaceId).issues.filter(
        (issue) =>
          !query || issue.title.toLowerCase().includes(query) || issue.number.includes(query),
      );
      return { items, searchSupported: true, incompleteResults: false };
    },
    issueItemGet: async ({ workspaceId, sourceId }) => {
      const issue = findWorkspace(world, workspaceId).issues.find(
        (item) => item.sourceId === sourceId,
      );
      if (!issue) throw new Error("This issue is not in the demo repository. Refresh the list.");
      return issue;
    },
    issueItemsImport: async ({ workspaceId, items }) => {
      const workspace = findWorkspace(world, workspaceId);
      const results = [];
      const issues = new Map(workspace.issues.map((issue) => [issue.sourceId, issue]));
      for (const item of items) {
        const issue = issues.get(item.sourceId);
        if (!issue || issue.linkedTaskId) {
          results.push({
            sourceId: item.sourceId,
            outcome: "failed" as const,
            reason: "This issue is already imported.",
          });
          continue;
        }
        const card = createTask(
          { workspaceId },
          {
            title: issue.title,
            issueType: item.issueType,
            priority: item.priority,
            description: issue.description,
            labels: item.labels,
          },
        );
        const task = findTask(workspace, card.id);
        touch(task, {
          sourceIssue: {
            providerId: issue.providerId,
            scope: issue.scope,
            sourceId: issue.sourceId,
            number: issue.number,
            url: issue.url,
          },
        });
        issue.linkedTaskId = card.id;
        publish(workspace, { taskIds: [card.id] });
        results.push({ sourceId: item.sourceId, outcome: "created" as const, taskId: card.id });
      }
      return { results };
    },
  } satisfies DemoHandlers;

  return { handlers, publish, applyEvent, saveDocument, ensureWorktree, linkPullRequest, taskCard };
};

const decodedSize = (base64: string): number =>
  (base64.length / 4) * 3 - (base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0);

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** UTF-8 text as base64, without platform globals. */
const toBase64 = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let output = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index] ?? 0;
    const b = bytes[index + 1];
    const c = bytes[index + 2];
    output += BASE64[a >> 2];
    output += BASE64[((a & 3) << 4) | ((b ?? 0) >> 4)];
    output += b === undefined ? "=" : BASE64[((b & 15) << 2) | ((c ?? 0) >> 6)];
    output += c === undefined ? "=" : BASE64[c & 63];
  }
  return output;
};

/** base64 text as bytes, without platform globals. */
export const fromBase64 = (base64: string): Uint8Array<ArrayBuffer> => {
  const clean = base64.replace(/=+$/, "");
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of clean) {
    buffer = (buffer << 6) | BASE64.indexOf(char);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (buffer >> bits) & 0xff;
    }
  }
  return bytes;
};
