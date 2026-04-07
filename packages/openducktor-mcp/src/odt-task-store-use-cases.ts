import type { PullRequest } from "@openducktor/contracts";
import type {
  PublicTaskCreateInput,
  TaskPersistencePort,
  TaskSearchFilters,
} from "./beads-persistence";
import type { CanonicalPullRequestResolverPort } from "./canonical-pull-request-resolver";
import type { JsonObject, PublicTask, RawIssue, TaskStatus } from "./contracts";
import type { EpicSubtaskReplacementService } from "./epic-subtask-replacement";
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
  ReadTaskDocumentsInput,
  ReadTaskInput,
  SearchTasksInput,
  SetPlanInput,
  SetPullRequestInput,
  SetSpecInput,
} from "./tool-schemas";
import {
  assertNoValidationError,
  getSetPlanError,
  getSetPullRequestError,
  getSetSpecError,
  validatePlanSubtaskRules,
} from "./workflow-policy";

type PersistedDocumentResult = {
  markdown: string;
  updatedAt: string;
  revision: number;
};

export type TaskSnapshotResult = {
  task: PublicTask & {
    qaVerdict: "approved" | "rejected" | null;
    documents: {
      hasSpec: boolean;
      hasPlan: boolean;
      hasQaReport: boolean;
    };
  };
};

export type ReadTaskDocumentsResult = {
  documents: {
    spec?: { markdown: string; updatedAt: string | null };
    implementationPlan?: { markdown: string; updatedAt: string | null };
    latestQaReport?: {
      markdown: string;
      updatedAt: string | null;
      verdict: "approved" | "rejected" | null;
    };
  };
};

export type OdtTaskStoreUseCases = {
  readTask: OdtTaskStoreUseCase<ReadTaskInput, ReadTaskResult>;
  readTaskDocuments: OdtTaskStoreUseCase<ReadTaskDocumentsInput, ReadTaskDocumentsResult>;
  createTask: OdtTaskStoreUseCase<CreateTaskInput, CreateTaskResult>;
  searchTasks: OdtTaskStoreUseCase<SearchTasksInput, SearchTasksResult>;
  setSpec: OdtTaskStoreUseCase<SetSpecInput, SetSpecResult>;
  setPlan: OdtTaskStoreUseCase<SetPlanInput, SetPlanResult>;
  buildBlocked: OdtTaskStoreUseCase<BuildBlockedInput, BuildBlockedResult>;
  buildResumed: OdtTaskStoreUseCase<BuildResumedInput, BuildResumedResult>;
  buildCompleted: OdtTaskStoreUseCase<BuildCompletedInput, BuildCompletedResult>;
  setPullRequest: OdtTaskStoreUseCase<SetPullRequestInput, SetPullRequestResult>;
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

export type SetPullRequestResult = {
  task: PublicTask;
  pullRequest: PullRequest;
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
  documentStore: Pick<TaskDocumentPort, "summarize">,
): TaskSnapshotResult => {
  const summary = documentStore.summarize(issue);

  return {
    task: {
      ...issueToPublicTask(issue, metadataNamespace),
      qaVerdict: summary.qaVerdict,
      documents: summary.documents,
    },
  };
};

type ReadTaskUseCaseDeps = {
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    "ensureInitialized" | "readTaskSnapshot" | "metadataNamespace"
  >;
  documentStore: Pick<TaskDocumentPort, "summarize">;
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

type ReadTaskDocumentsUseCaseDeps = {
  workflow: Pick<OdtTaskWorkflowRuntimePort, "ensureInitialized" | "readTaskSnapshot">;
  documentStore: Pick<TaskDocumentPort, "readDocuments">;
};

export class ReadTaskDocumentsUseCase
  implements OdtTaskStoreUseCase<ReadTaskDocumentsInput, ReadTaskDocumentsResult>
{
  private readonly workflow: ReadTaskDocumentsUseCaseDeps["workflow"];
  private readonly documentStore: ReadTaskDocumentsUseCaseDeps["documentStore"];

  constructor(deps: ReadTaskDocumentsUseCaseDeps) {
    this.workflow = deps.workflow;
    this.documentStore = deps.documentStore;
  }

  async execute(input: ReadTaskDocumentsInput): Promise<ReadTaskDocumentsResult> {
    await this.workflow.ensureInitialized();
    const { issue } = await this.workflow.readTaskSnapshot(input.taskId);
    return this.documentStore.readDocuments(issue, input);
  }
}

type CreateTaskUseCaseDeps = {
  persistence: Pick<TaskPersistencePort, "createTask" | "ensureInitialized" | "metadataNamespace">;
  documentStore: Pick<TaskDocumentPort, "summarize">;
  invalidateTaskIndex(): void;
};

export class CreateTaskUseCase implements OdtTaskStoreUseCase<CreateTaskInput, CreateTaskResult> {
  private readonly persistence: CreateTaskUseCaseDeps["persistence"];
  private readonly documentStore: CreateTaskUseCaseDeps["documentStore"];
  private readonly invalidateTaskIndex: CreateTaskUseCaseDeps["invalidateTaskIndex"];

  constructor(deps: CreateTaskUseCaseDeps) {
    this.persistence = deps.persistence;
    this.documentStore = deps.documentStore;
    this.invalidateTaskIndex = deps.invalidateTaskIndex;
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
    try {
      const issue = await this.persistence.createTask(createInput);
      return toTaskSnapshotResult(issue, this.persistence.metadataNamespace, this.documentStore);
    } finally {
      this.invalidateTaskIndex();
    }
  }
}

type SearchTasksUseCaseDeps = {
  persistence: Pick<
    TaskPersistencePort,
    "ensureInitialized" | "listRawIssues" | "metadataNamespace"
  >;
  documentStore: Pick<TaskDocumentPort, "summarize">;
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
    const parsedTasks = issues.map((issue) => ({
      issue,
      task: issueToPublicTask(issue, this.persistence.metadataNamespace),
    }));
    const activeIssues = parsedTasks.filter(({ task }) => ACTIVE_TASK_STATUSES.has(task.status));
    const totalCount = activeIssues.length;
    const results = activeIssues.slice(0, input.limit).map(({ issue, task }) => {
      const summary = this.documentStore.summarize(issue);
      return {
        task: {
          ...task,
          qaVerdict: summary.qaVerdict,
          documents: summary.documents,
        },
      };
    });

    return {
      results,
      limit: input.limit,
      totalCount,
      hasMore: totalCount > results.length,
    };
  }
}

type SetSpecUseCaseDeps = {
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    | "ensureInitialized"
    | "metadataNamespace"
    | "refreshTaskContext"
    | "resolveTaskContext"
    | "transitionTask"
  >;
  documentStore: Pick<TaskDocumentPort, "persistSpec">;
};

export class SetSpecUseCase implements OdtTaskStoreUseCase<SetSpecInput, SetSpecResult> {
  private readonly workflow: SetSpecUseCaseDeps["workflow"];
  private readonly documentStore: SetSpecUseCaseDeps["documentStore"];

  constructor(deps: SetSpecUseCaseDeps) {
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

    let nextIssue = persistedDocument.issue;
    if (task.status === "open") {
      const refreshedContext = await this.workflow.refreshTaskContext(task.id, context);
      const transitionedTask = await this.workflow.transitionTask(
        task.id,
        "spec_ready",
        refreshedContext,
      );
      nextIssue = transitionedTask.issue;
    }

    return {
      task: issueToPublicTask(nextIssue, this.workflow.metadataNamespace),
      document: {
        markdown,
        updatedAt: persistedDocument.updatedAt,
        revision: persistedDocument.revision,
      },
    };
  }
}

type SetPlanUseCaseDeps = {
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    | "ensureInitialized"
    | "metadataNamespace"
    | "refreshTaskContext"
    | "resolveTaskContext"
    | "transitionTask"
  >;
  documentStore: Pick<TaskDocumentPort, "persistImplementationPlan">;
  epicSubtaskReplacementService: EpicSubtaskReplacementPort;
};

export class SetPlanUseCase implements OdtTaskStoreUseCase<SetPlanInput, SetPlanResult> {
  private readonly workflow: SetPlanUseCaseDeps["workflow"];
  private readonly documentStore: SetPlanUseCaseDeps["documentStore"];
  private readonly epicSubtaskReplacementService: SetPlanUseCaseDeps["epicSubtaskReplacementService"];

  constructor(deps: SetPlanUseCaseDeps) {
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
    let persistedDocument: Awaited<ReturnType<TaskDocumentPort["persistImplementationPlan"]>>;
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
    const transitionedTask = await this.workflow.transitionTask(
      task.id,
      "ready_for_dev",
      refreshedContext,
    );

    return {
      task: issueToPublicTask(transitionedTask.issue, this.workflow.metadataNamespace),
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
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    "ensureInitialized" | "metadataNamespace" | "transitionTask"
  >;
};

export class BuildBlockedUseCase
  implements OdtTaskStoreUseCase<BuildBlockedInput, BuildBlockedResult>
{
  private readonly workflow: TransitionTaskUseCaseDeps["workflow"];

  constructor(deps: TransitionTaskUseCaseDeps) {
    this.workflow = deps.workflow;
  }

  async execute(input: BuildBlockedInput): Promise<BuildBlockedResult> {
    await this.workflow.ensureInitialized();
    const nextTask = await this.workflow.transitionTask(input.taskId, "blocked");
    return {
      task: issueToPublicTask(nextTask.issue, this.workflow.metadataNamespace),
      reason: input.reason,
    };
  }
}

export class BuildResumedUseCase
  implements OdtTaskStoreUseCase<BuildResumedInput, BuildResumedResult>
{
  private readonly workflow: TransitionTaskUseCaseDeps["workflow"];

  constructor(deps: TransitionTaskUseCaseDeps) {
    this.workflow = deps.workflow;
  }

  async execute(input: BuildResumedInput): Promise<BuildResumedResult> {
    await this.workflow.ensureInitialized();
    const nextTask = await this.workflow.transitionTask(input.taskId, "in_progress");
    return {
      task: issueToPublicTask(nextTask.issue, this.workflow.metadataNamespace),
    };
  }
}

type BuildCompletedUseCaseDeps = {
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    | "ensureInitialized"
    | "metadataNamespace"
    | "readTaskSnapshot"
    | "refreshTaskContext"
    | "resolveTaskContext"
    | "transitionTask"
  >;
  documentStore: Pick<TaskDocumentPort, "summarize">;
};

export class BuildCompletedUseCase
  implements OdtTaskStoreUseCase<BuildCompletedInput, BuildCompletedResult>
{
  private readonly workflow: BuildCompletedUseCaseDeps["workflow"];
  private readonly documentStore: BuildCompletedUseCaseDeps["documentStore"];

  constructor(deps: BuildCompletedUseCaseDeps) {
    this.workflow = deps.workflow;
    this.documentStore = deps.documentStore;
  }

  async execute(input: BuildCompletedInput): Promise<BuildCompletedResult> {
    await this.workflow.ensureInitialized();

    const context = await this.workflow.resolveTaskContext(input.taskId);
    const refreshedContext = await this.workflow.refreshTaskContext(context.task.id, context);
    const { issue, task } = await this.workflow.readTaskSnapshot(refreshedContext.task.id);
    const documents = this.documentStore.summarize(issue);

    const nextStatus =
      task.aiReviewEnabled && documents.qaVerdict !== "approved" ? "ai_review" : "human_review";
    const updatedTask = await this.workflow.transitionTask(task.id, nextStatus, refreshedContext);
    return {
      task: issueToPublicTask(updatedTask.issue, this.workflow.metadataNamespace),
      ...(input.summary ? { summary: input.summary } : {}),
    };
  }
}

type SetPullRequestUseCaseDeps = {
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    "ensureInitialized" | "metadataNamespace" | "readTaskSnapshot"
  >;
  persistence: Pick<TaskPersistencePort, "getNamespaceData" | "writeNamespace">;
  pullRequestResolver: CanonicalPullRequestResolverPort;
};

const toPullRequestMetadata = (pullRequest: PullRequest): JsonObject => ({
  providerId: pullRequest.providerId,
  number: pullRequest.number,
  url: pullRequest.url,
  state: pullRequest.state,
  createdAt: pullRequest.createdAt,
  updatedAt: pullRequest.updatedAt,
  ...(pullRequest.lastSyncedAt ? { lastSyncedAt: pullRequest.lastSyncedAt } : {}),
  ...(pullRequest.mergedAt ? { mergedAt: pullRequest.mergedAt } : {}),
  ...(pullRequest.closedAt ? { closedAt: pullRequest.closedAt } : {}),
});

export class SetPullRequestUseCase
  implements OdtTaskStoreUseCase<SetPullRequestInput, SetPullRequestResult>
{
  private readonly workflow: SetPullRequestUseCaseDeps["workflow"];
  private readonly persistence: SetPullRequestUseCaseDeps["persistence"];
  private readonly pullRequestResolver: SetPullRequestUseCaseDeps["pullRequestResolver"];

  constructor(deps: SetPullRequestUseCaseDeps) {
    this.workflow = deps.workflow;
    this.persistence = deps.persistence;
    this.pullRequestResolver = deps.pullRequestResolver;
  }

  async execute(input: SetPullRequestInput): Promise<SetPullRequestResult> {
    await this.workflow.ensureInitialized();
    const { issue, task } = await this.workflow.readTaskSnapshot(input.taskId);
    assertNoValidationError(getSetPullRequestError(task.status));
    const pullRequest = await this.pullRequestResolver.resolve({
      providerId: input.providerId,
      number: input.number,
    });

    const { root, namespace } = this.persistence.getNamespaceData(issue);
    await this.persistence.writeNamespace(input.taskId, root, {
      ...namespace,
      pullRequest: toPullRequestMetadata(pullRequest),
    });
    const { issue: refreshedIssue } = await this.workflow.readTaskSnapshot(input.taskId);

    return {
      task: issueToPublicTask(refreshedIssue, this.workflow.metadataNamespace),
      pullRequest,
    };
  }
}

type QaUseCaseDeps = {
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    | "applyTaskUpdate"
    | "assertTransitionAllowed"
    | "ensureInitialized"
    | "metadataNamespace"
    | "readTaskSnapshot"
  >;
  documentStore: Pick<TaskDocumentPort, "prepareQaReportWrite">;
};

export class QaApprovedUseCase implements OdtTaskStoreUseCase<QaApprovedInput, QaApprovedResult> {
  private readonly workflow: QaUseCaseDeps["workflow"];
  private readonly documentStore: QaUseCaseDeps["documentStore"];

  constructor(deps: QaUseCaseDeps) {
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
      task: issueToPublicTask(updatedTask.issue, this.workflow.metadataNamespace),
    };
  }
}

export class QaRejectedUseCase implements OdtTaskStoreUseCase<QaRejectedInput, QaRejectedResult> {
  private readonly workflow: QaUseCaseDeps["workflow"];
  private readonly documentStore: QaUseCaseDeps["documentStore"];

  constructor(deps: QaUseCaseDeps) {
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
      task: issueToPublicTask(updatedTask.issue, this.workflow.metadataNamespace),
    };
  }
}

export type CreateOdtTaskStoreUseCasesDeps = {
  persistence: TaskPersistencePort;
  workflow: OdtTaskWorkflowRuntimePort;
  documentStore: TaskDocumentPort;
  epicSubtaskReplacementService: EpicSubtaskReplacementPort;
  pullRequestResolver: CanonicalPullRequestResolverPort;
  invalidateTaskIndex(): void;
};

export const createOdtTaskStoreUseCases = (
  deps: CreateOdtTaskStoreUseCasesDeps,
): OdtTaskStoreUseCases => ({
  readTask: new ReadTaskUseCase({
    workflow: deps.workflow,
    documentStore: deps.documentStore,
  }),
  readTaskDocuments: new ReadTaskDocumentsUseCase({
    workflow: deps.workflow,
    documentStore: deps.documentStore,
  }),
  createTask: new CreateTaskUseCase({
    persistence: deps.persistence,
    documentStore: deps.documentStore,
    invalidateTaskIndex: deps.invalidateTaskIndex,
  }),
  searchTasks: new SearchTasksUseCase({
    persistence: deps.persistence,
    documentStore: deps.documentStore,
  }),
  setSpec: new SetSpecUseCase({
    workflow: deps.workflow,
    documentStore: deps.documentStore,
  }),
  setPlan: new SetPlanUseCase({
    workflow: deps.workflow,
    documentStore: deps.documentStore,
    epicSubtaskReplacementService: deps.epicSubtaskReplacementService,
  }),
  buildBlocked: new BuildBlockedUseCase({
    workflow: deps.workflow,
  }),
  buildResumed: new BuildResumedUseCase({
    workflow: deps.workflow,
  }),
  buildCompleted: new BuildCompletedUseCase({
    workflow: deps.workflow,
    documentStore: deps.documentStore,
  }),
  setPullRequest: new SetPullRequestUseCase({
    workflow: deps.workflow,
    persistence: deps.persistence,
    pullRequestResolver: deps.pullRequestResolver,
  }),
  qaApproved: new QaApprovedUseCase({
    workflow: deps.workflow,
    documentStore: deps.documentStore,
  }),
  qaRejected: new QaRejectedUseCase({
    workflow: deps.workflow,
    documentStore: deps.documentStore,
  }),
});
