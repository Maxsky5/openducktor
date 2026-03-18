import type {
  PublicTaskCreateInput,
  TaskPersistencePort,
  TaskSearchFilters,
} from "./bd-persistence";
import type { PublicTask, RawIssue, TaskCard, TaskStatus } from "./contracts";
import type { EpicSubtaskReplacementService } from "./epic-subtask-replacement";
import type { TaskDocumentsSnapshot } from "./metadata-docs";
import { normalizePlanSubtasks } from "./plan-subtasks";
import type { TaskDocumentPort } from "./task-document-store";
import { issueToPublicTask } from "./task-mapping";
import type { OdtTaskWorkflowRuntimePort } from "./task-workflow-runtime";
import type {
  BuildBlockedInput,
  BuildCompletedInput,
  BuildResumedInput,
  CreateTaskInput,
  QaApprovedInput,
  QaRejectedInput,
  ReadTaskInput,
  SearchTasksInput,
  SetPlanInput,
  SetSpecInput,
} from "./tool-schemas";
import {
  assertNoValidationError,
  getSetPlanError,
  getSetSpecError,
  validatePlanSubtaskRules,
} from "./workflow-policy";

type PersistedDocumentResult = {
  markdown: string;
  updatedAt: string;
  revision: number;
};

export type TaskSnapshotResult = {
  task: PublicTask;
  documents: TaskDocumentsSnapshot;
};

export type OdtTaskStoreUseCases = {
  readTask: OdtTaskStoreUseCase<ReadTaskInput, ReadTaskResult>;
  createTask: OdtTaskStoreUseCase<CreateTaskInput, CreateTaskResult>;
  searchTasks: OdtTaskStoreUseCase<SearchTasksInput, SearchTasksResult>;
  setSpec: OdtTaskStoreUseCase<SetSpecInput, SetSpecResult>;
  setPlan: OdtTaskStoreUseCase<SetPlanInput, SetPlanResult>;
  buildBlocked: OdtTaskStoreUseCase<BuildBlockedInput, BuildBlockedResult>;
  buildResumed: OdtTaskStoreUseCase<BuildResumedInput, BuildResumedResult>;
  buildCompleted: OdtTaskStoreUseCase<BuildCompletedInput, BuildCompletedResult>;
  qaApproved: OdtTaskStoreUseCase<QaApprovedInput, QaApprovedResult>;
  qaRejected: OdtTaskStoreUseCase<QaRejectedInput, QaRejectedResult>;
};

export type OdtTaskStoreUseCase<Input, Output> = {
  execute(input: Input): Promise<Output>;
};

export type ReadTaskResult = TaskSnapshotResult;
export type CreateTaskResult = TaskSnapshotResult;

export type SearchTasksResult = {
  results: TaskSnapshotResult[];
  limit: number;
  totalCount: number;
  hasMore: boolean;
};

export type SetSpecResult = {
  task: PublicTask;
  document: PersistedDocumentResult;
};

export type SetPlanResult = {
  task: PublicTask;
  document: PersistedDocumentResult;
  createdSubtaskIds: string[];
};

export type BuildBlockedResult = {
  task: PublicTask;
  reason: string;
};

export type BuildResumedResult = {
  task: PublicTask;
};

export type BuildCompletedResult = {
  task: PublicTask;
  summary?: string;
};

export type QaApprovedResult = {
  task: PublicTask;
};

export type QaRejectedResult = {
  task: PublicTask;
};

type EpicSubtaskReplacementPort = Pick<
  EpicSubtaskReplacementService,
  "prepareReplacement" | "applyReplacement"
>;

const ACTIVE_TASK_STATUSES = new Set<TaskStatus>([
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
  "ai_review",
  "human_review",
]);

const toTaskSnapshotResult = (
  issue: RawIssue,
  metadataNamespace: string,
  documentStore: Pick<TaskDocumentPort, "parseDocs">,
): TaskSnapshotResult => ({
  task: issueToPublicTask(issue, metadataNamespace),
  documents: documentStore.parseDocs(issue),
});

const toPublicTaskFromWorkflow = async (
  persistence: Pick<TaskPersistencePort, "metadataNamespace" | "showRawIssue">,
  taskId: string,
): Promise<PublicTask> => {
  const issue = await persistence.showRawIssue(taskId);
  return issueToPublicTask(issue, persistence.metadataNamespace);
};

type ReadTaskUseCaseDeps = {
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    "ensureInitialized" | "readTaskSnapshot" | "metadataNamespace"
  >;
  documentStore: Pick<TaskDocumentPort, "parseDocs">;
};

export class ReadTaskUseCase implements OdtTaskStoreUseCase<ReadTaskInput, ReadTaskResult> {
  private readonly workflow: ReadTaskUseCaseDeps["workflow"];
  private readonly documentStore: ReadTaskUseCaseDeps["documentStore"];

  constructor(deps: ReadTaskUseCaseDeps) {
    this.workflow = deps.workflow;
    this.documentStore = deps.documentStore;
  }

  async execute(input: ReadTaskInput): Promise<ReadTaskResult> {
    await this.workflow.ensureInitialized();
    const { issue } = await this.workflow.readTaskSnapshot(input.taskId);
    return toTaskSnapshotResult(issue, this.workflow.metadataNamespace, this.documentStore);
  }
}

type CreateTaskUseCaseDeps = {
  persistence: Pick<TaskPersistencePort, "createTask" | "ensureInitialized" | "metadataNamespace">;
  documentStore: Pick<TaskDocumentPort, "parseDocs">;
};

export class CreateTaskUseCase implements OdtTaskStoreUseCase<CreateTaskInput, CreateTaskResult> {
  private readonly persistence: CreateTaskUseCaseDeps["persistence"];
  private readonly documentStore: CreateTaskUseCaseDeps["documentStore"];

  constructor(deps: CreateTaskUseCaseDeps) {
    this.persistence = deps.persistence;
    this.documentStore = deps.documentStore;
  }

  async execute(input: CreateTaskInput): Promise<CreateTaskResult> {
    await this.persistence.ensureInitialized();
    const createInput: PublicTaskCreateInput = {
      title: input.title.trim(),
      issueType: input.issueType,
      priority: input.priority,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.labels !== undefined ? { labels: input.labels } : {}),
      ...(input.aiReviewEnabled !== undefined ? { aiReviewEnabled: input.aiReviewEnabled } : {}),
    };
    const issue = await this.persistence.createTask(createInput);
    return toTaskSnapshotResult(issue, this.persistence.metadataNamespace, this.documentStore);
  }
}

type SearchTasksUseCaseDeps = {
  persistence: Pick<
    TaskPersistencePort,
    "ensureInitialized" | "listRawIssues" | "metadataNamespace"
  >;
  documentStore: Pick<TaskDocumentPort, "parseDocs">;
};

export class SearchTasksUseCase
  implements OdtTaskStoreUseCase<SearchTasksInput, SearchTasksResult>
{
  private readonly persistence: SearchTasksUseCaseDeps["persistence"];
  private readonly documentStore: SearchTasksUseCaseDeps["documentStore"];

  constructor(deps: SearchTasksUseCaseDeps) {
    this.persistence = deps.persistence;
    this.documentStore = deps.documentStore;
  }

  async execute(input: SearchTasksInput): Promise<SearchTasksResult> {
    await this.persistence.ensureInitialized();
    const filters: TaskSearchFilters = {
      ...(input.priority !== undefined ? { priority: input.priority } : {}),
      ...(input.issueType ? { issueType: input.issueType } : {}),
      ...(input.status ? { status: input.status } : {}),
      ...(input.title ? { title: input.title } : {}),
      ...(input.tags ? { tags: input.tags } : {}),
    };
    const issues = await this.persistence.listRawIssues(filters);
    const activeIssues = issues.filter((issue) =>
      ACTIVE_TASK_STATUSES.has(issue.status as TaskStatus),
    );
    const totalCount = activeIssues.length;
    const results = activeIssues
      .slice(0, input.limit)
      .map((issue) =>
        toTaskSnapshotResult(issue, this.persistence.metadataNamespace, this.documentStore),
      );

    return {
      results,
      limit: input.limit,
      totalCount,
      hasMore: totalCount > results.length,
    };
  }
}

type SetSpecUseCaseDeps = {
  persistence: Pick<TaskPersistencePort, "metadataNamespace" | "showRawIssue">;
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    "ensureInitialized" | "resolveTaskContext" | "refreshTaskContext" | "transitionTask"
  >;
  documentStore: Pick<TaskDocumentPort, "persistSpec">;
};

export class SetSpecUseCase implements OdtTaskStoreUseCase<SetSpecInput, SetSpecResult> {
  private readonly persistence: SetSpecUseCaseDeps["persistence"];
  private readonly workflow: SetSpecUseCaseDeps["workflow"];
  private readonly documentStore: SetSpecUseCaseDeps["documentStore"];

  constructor(deps: SetSpecUseCaseDeps) {
    this.persistence = deps.persistence;
    this.workflow = deps.workflow;
    this.documentStore = deps.documentStore;
  }

  async execute(input: SetSpecInput): Promise<SetSpecResult> {
    await this.workflow.ensureInitialized();
    const markdown = input.markdown.trim();

    const context = await this.workflow.resolveTaskContext(input.taskId);
    const { task } = context;
    assertNoValidationError(getSetSpecError(task.status));

    const persistedDocument = await this.documentStore.persistSpec(task.id, markdown);

    let nextTask: TaskCard = task;
    if (task.status === "open") {
      const refreshedContext = await this.workflow.refreshTaskContext(task.id, context);
      nextTask = await this.workflow.transitionTask(task.id, "spec_ready", refreshedContext);
    }

    return {
      task: await toPublicTaskFromWorkflow(this.persistence, nextTask.id),
      document: {
        markdown,
        updatedAt: persistedDocument.updatedAt,
        revision: persistedDocument.revision,
      },
    };
  }
}

type SetPlanUseCaseDeps = {
  persistence: Pick<TaskPersistencePort, "metadataNamespace" | "showRawIssue">;
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    "ensureInitialized" | "resolveTaskContext" | "refreshTaskContext" | "transitionTask"
  >;
  documentStore: Pick<TaskDocumentPort, "persistImplementationPlan">;
  epicSubtaskReplacementService: EpicSubtaskReplacementPort;
};

export class SetPlanUseCase implements OdtTaskStoreUseCase<SetPlanInput, SetPlanResult> {
  private readonly persistence: SetPlanUseCaseDeps["persistence"];
  private readonly workflow: SetPlanUseCaseDeps["workflow"];
  private readonly documentStore: SetPlanUseCaseDeps["documentStore"];
  private readonly epicSubtaskReplacementService: SetPlanUseCaseDeps["epicSubtaskReplacementService"];

  constructor(deps: SetPlanUseCaseDeps) {
    this.persistence = deps.persistence;
    this.workflow = deps.workflow;
    this.documentStore = deps.documentStore;
    this.epicSubtaskReplacementService = deps.epicSubtaskReplacementService;
  }

  async execute(input: SetPlanInput): Promise<SetPlanResult> {
    await this.workflow.ensureInitialized();
    const markdown = input.markdown.trim();

    const context = await this.workflow.resolveTaskContext(input.taskId);
    const { task, tasks } = context;

    const normalizedSubtasks = normalizePlanSubtasks(input.subtasks ?? []);
    let persistedDocument: { updatedAt: string; revision: number };
    let createdSubtaskIds: string[] = [];
    if (task.issueType === "epic") {
      const epicReplacement = await this.epicSubtaskReplacementService.prepareReplacement(
        task,
        normalizedSubtasks,
      );
      persistedDocument = await this.documentStore.persistImplementationPlan(task.id, markdown);
      createdSubtaskIds = await this.epicSubtaskReplacementService.applyReplacement(
        epicReplacement.latestTask,
        epicReplacement.existingDirectSubtasks,
        normalizedSubtasks,
      );
    } else {
      assertNoValidationError(getSetPlanError(task));
      validatePlanSubtaskRules(task, tasks, normalizedSubtasks);
      persistedDocument = await this.documentStore.persistImplementationPlan(task.id, markdown);
    }

    const refreshedContext = await this.workflow.refreshTaskContext(task.id, context);
    const nextTask = await this.workflow.transitionTask(task.id, "ready_for_dev", refreshedContext);

    return {
      task: await toPublicTaskFromWorkflow(this.persistence, nextTask.id),
      document: {
        markdown,
        updatedAt: persistedDocument.updatedAt,
        revision: persistedDocument.revision,
      },
      createdSubtaskIds,
    };
  }
}

type TransitionTaskUseCaseDeps = {
  persistence: Pick<TaskPersistencePort, "metadataNamespace" | "showRawIssue">;
  workflow: Pick<OdtTaskWorkflowRuntimePort, "ensureInitialized" | "transitionTask">;
};

export class BuildBlockedUseCase
  implements OdtTaskStoreUseCase<BuildBlockedInput, BuildBlockedResult>
{
  private readonly persistence: TransitionTaskUseCaseDeps["persistence"];
  private readonly workflow: TransitionTaskUseCaseDeps["workflow"];

  constructor(deps: TransitionTaskUseCaseDeps) {
    this.persistence = deps.persistence;
    this.workflow = deps.workflow;
  }

  async execute(input: BuildBlockedInput): Promise<BuildBlockedResult> {
    await this.workflow.ensureInitialized();
    const task = await this.workflow.transitionTask(input.taskId, "blocked");
    return {
      task: await toPublicTaskFromWorkflow(this.persistence, task.id),
      reason: input.reason,
    };
  }
}

export class BuildResumedUseCase
  implements OdtTaskStoreUseCase<BuildResumedInput, BuildResumedResult>
{
  private readonly persistence: TransitionTaskUseCaseDeps["persistence"];
  private readonly workflow: TransitionTaskUseCaseDeps["workflow"];

  constructor(deps: TransitionTaskUseCaseDeps) {
    this.persistence = deps.persistence;
    this.workflow = deps.workflow;
  }

  async execute(input: BuildResumedInput): Promise<BuildResumedResult> {
    await this.workflow.ensureInitialized();
    const task = await this.workflow.transitionTask(input.taskId, "in_progress");
    return {
      task: await toPublicTaskFromWorkflow(this.persistence, task.id),
    };
  }
}

type BuildCompletedUseCaseDeps = {
  persistence: Pick<TaskPersistencePort, "metadataNamespace" | "showRawIssue">;
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    | "ensureInitialized"
    | "readTaskSnapshot"
    | "resolveTaskContext"
    | "refreshTaskContext"
    | "transitionTask"
  >;
  documentStore: Pick<TaskDocumentPort, "parseDocs">;
};

export class BuildCompletedUseCase
  implements OdtTaskStoreUseCase<BuildCompletedInput, BuildCompletedResult>
{
  private readonly persistence: BuildCompletedUseCaseDeps["persistence"];
  private readonly workflow: BuildCompletedUseCaseDeps["workflow"];
  private readonly documentStore: BuildCompletedUseCaseDeps["documentStore"];

  constructor(deps: BuildCompletedUseCaseDeps) {
    this.persistence = deps.persistence;
    this.workflow = deps.workflow;
    this.documentStore = deps.documentStore;
  }

  async execute(input: BuildCompletedInput): Promise<BuildCompletedResult> {
    await this.workflow.ensureInitialized();

    const context = await this.workflow.resolveTaskContext(input.taskId);
    const refreshedContext = await this.workflow.refreshTaskContext(context.task.id, context);
    const { task } = refreshedContext;
    const { issue } = await this.workflow.readTaskSnapshot(task.id);
    const documents = this.documentStore.parseDocs(issue);

    const nextStatus =
      task.aiReviewEnabled && documents.latestQaReport.verdict !== "approved"
        ? "ai_review"
        : "human_review";
    const updatedTask = await this.workflow.transitionTask(task.id, nextStatus, refreshedContext);
    return {
      task: await toPublicTaskFromWorkflow(this.persistence, updatedTask.id),
      ...(input.summary ? { summary: input.summary } : {}),
    };
  }
}

type QaUseCaseDeps = {
  persistence: Pick<TaskPersistencePort, "metadataNamespace" | "showRawIssue">;
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    "applyTaskUpdate" | "assertTransitionAllowed" | "ensureInitialized" | "readTaskSnapshot"
  >;
  documentStore: Pick<TaskDocumentPort, "prepareQaReportWrite">;
};

export class QaApprovedUseCase implements OdtTaskStoreUseCase<QaApprovedInput, QaApprovedResult> {
  private readonly persistence: QaUseCaseDeps["persistence"];
  private readonly workflow: QaUseCaseDeps["workflow"];
  private readonly documentStore: QaUseCaseDeps["documentStore"];

  constructor(deps: QaUseCaseDeps) {
    this.persistence = deps.persistence;
    this.workflow = deps.workflow;
    this.documentStore = deps.documentStore;
  }

  async execute(input: QaApprovedInput): Promise<QaApprovedResult> {
    await this.workflow.ensureInitialized();
    const { issue, task } = await this.workflow.readTaskSnapshot(input.taskId);
    if (task.status !== "ai_review" && task.status !== "human_review") {
      throw new Error(
        `QA outcomes are only allowed from ai_review or human_review (current: ${task.status}).`,
      );
    }
    this.workflow.assertTransitionAllowed(task, [task], "human_review");
    const preparedWrite = this.documentStore.prepareQaReportWrite(
      issue,
      input.reportMarkdown.trim(),
      "approved",
    );
    const updatedTask = await this.workflow.applyTaskUpdate(task.id, {
      metadataRoot: preparedWrite.metadataRoot,
      status: "human_review",
    });
    return {
      task: await toPublicTaskFromWorkflow(this.persistence, updatedTask.id),
    };
  }
}

export class QaRejectedUseCase implements OdtTaskStoreUseCase<QaRejectedInput, QaRejectedResult> {
  private readonly persistence: QaUseCaseDeps["persistence"];
  private readonly workflow: QaUseCaseDeps["workflow"];
  private readonly documentStore: QaUseCaseDeps["documentStore"];

  constructor(deps: QaUseCaseDeps) {
    this.persistence = deps.persistence;
    this.workflow = deps.workflow;
    this.documentStore = deps.documentStore;
  }

  async execute(input: QaRejectedInput): Promise<QaRejectedResult> {
    await this.workflow.ensureInitialized();
    const { issue, task } = await this.workflow.readTaskSnapshot(input.taskId);
    if (task.status !== "ai_review" && task.status !== "human_review") {
      throw new Error(
        `QA outcomes are only allowed from ai_review or human_review (current: ${task.status}).`,
      );
    }
    this.workflow.assertTransitionAllowed(task, [task], "in_progress");
    const preparedWrite = this.documentStore.prepareQaReportWrite(
      issue,
      input.reportMarkdown.trim(),
      "rejected",
    );
    const updatedTask = await this.workflow.applyTaskUpdate(task.id, {
      metadataRoot: preparedWrite.metadataRoot,
      status: "in_progress",
    });
    return {
      task: await toPublicTaskFromWorkflow(this.persistence, updatedTask.id),
    };
  }
}

export type CreateOdtTaskStoreUseCasesDeps = {
  persistence: TaskPersistencePort;
  workflow: OdtTaskWorkflowRuntimePort;
  documentStore: TaskDocumentPort;
  epicSubtaskReplacementService: EpicSubtaskReplacementPort;
};

export const createOdtTaskStoreUseCases = (
  deps: CreateOdtTaskStoreUseCasesDeps,
): OdtTaskStoreUseCases => ({
  readTask: new ReadTaskUseCase({
    workflow: deps.workflow,
    documentStore: deps.documentStore,
  }),
  createTask: new CreateTaskUseCase({
    persistence: deps.persistence,
    documentStore: deps.documentStore,
  }),
  searchTasks: new SearchTasksUseCase({
    persistence: deps.persistence,
    documentStore: deps.documentStore,
  }),
  setSpec: new SetSpecUseCase({
    persistence: deps.persistence,
    workflow: deps.workflow,
    documentStore: deps.documentStore,
  }),
  setPlan: new SetPlanUseCase({
    persistence: deps.persistence,
    workflow: deps.workflow,
    documentStore: deps.documentStore,
    epicSubtaskReplacementService: deps.epicSubtaskReplacementService,
  }),
  buildBlocked: new BuildBlockedUseCase({
    persistence: deps.persistence,
    workflow: deps.workflow,
  }),
  buildResumed: new BuildResumedUseCase({
    persistence: deps.persistence,
    workflow: deps.workflow,
  }),
  buildCompleted: new BuildCompletedUseCase({
    persistence: deps.persistence,
    workflow: deps.workflow,
    documentStore: deps.documentStore,
  }),
  qaApproved: new QaApprovedUseCase({
    persistence: deps.persistence,
    workflow: deps.workflow,
    documentStore: deps.documentStore,
  }),
  qaRejected: new QaRejectedUseCase({
    persistence: deps.persistence,
    workflow: deps.workflow,
    documentStore: deps.documentStore,
  }),
});
