import type { TaskCard } from "./contracts";
import type { EpicSubtaskReplacementService } from "./epic-subtask-replacement";
import { normalizePlanSubtasks } from "./plan-subtasks";
import type { TaskDocumentPort } from "./task-document-store";
import type { OdtTaskWorkflowRuntimePort } from "./task-workflow-runtime";
import {
  BuildBlockedInputSchema,
  BuildCompletedInputSchema,
  BuildResumedInputSchema,
  QaApprovedInputSchema,
  QaRejectedInputSchema,
  ReadTaskInputSchema,
  SetPlanInputSchema,
  SetSpecInputSchema,
} from "./tool-schemas";
import {
  assertNoValidationError,
  getSetPlanError,
  getSetSpecError,
  validatePlanSubtaskRules,
} from "./workflow-policy";

export type OdtTaskStoreUseCase = {
  execute(rawInput: unknown): Promise<unknown>;
};

export type OdtTaskStoreUseCases = {
  readTask: OdtTaskStoreUseCase;
  setSpec: OdtTaskStoreUseCase;
  setPlan: OdtTaskStoreUseCase;
  buildBlocked: OdtTaskStoreUseCase;
  buildResumed: OdtTaskStoreUseCase;
  buildCompleted: OdtTaskStoreUseCase;
  qaApproved: OdtTaskStoreUseCase;
  qaRejected: OdtTaskStoreUseCase;
};

type EpicSubtaskReplacementPort = Pick<
  EpicSubtaskReplacementService,
  "prepareReplacement" | "applyReplacement"
>;

type ReadTaskUseCaseDeps = {
  workflow: Pick<OdtTaskWorkflowRuntimePort, "ensureInitialized" | "readTaskSnapshot">;
  documentStore: Pick<TaskDocumentPort, "parseDocs">;
};

export class ReadTaskUseCase implements OdtTaskStoreUseCase {
  private readonly workflow: ReadTaskUseCaseDeps["workflow"];
  private readonly documentStore: ReadTaskUseCaseDeps["documentStore"];

  constructor(deps: ReadTaskUseCaseDeps) {
    this.workflow = deps.workflow;
    this.documentStore = deps.documentStore;
  }

  async execute(rawInput: unknown): Promise<unknown> {
    await this.workflow.ensureInitialized();
    const input = ReadTaskInputSchema.parse(rawInput);
    const { issue, task } = await this.workflow.readTaskSnapshot(input.taskId);

    return {
      task,
      documents: this.documentStore.parseDocs(issue),
    };
  }
}

type SetSpecUseCaseDeps = {
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    "ensureInitialized" | "resolveTaskContext" | "refreshTaskContext" | "transitionTask"
  >;
  documentStore: Pick<TaskDocumentPort, "persistSpec">;
};

export class SetSpecUseCase implements OdtTaskStoreUseCase {
  private readonly workflow: SetSpecUseCaseDeps["workflow"];
  private readonly documentStore: SetSpecUseCaseDeps["documentStore"];

  constructor(deps: SetSpecUseCaseDeps) {
    this.workflow = deps.workflow;
    this.documentStore = deps.documentStore;
  }

  async execute(rawInput: unknown): Promise<unknown> {
    await this.workflow.ensureInitialized();
    const input = SetSpecInputSchema.parse(rawInput);
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
      task: nextTask,
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
    "ensureInitialized" | "resolveTaskContext" | "refreshTaskContext" | "transitionTask"
  >;
  documentStore: Pick<TaskDocumentPort, "persistImplementationPlan">;
  epicSubtaskReplacementService: EpicSubtaskReplacementPort;
};

export class SetPlanUseCase implements OdtTaskStoreUseCase {
  private readonly workflow: SetPlanUseCaseDeps["workflow"];
  private readonly documentStore: SetPlanUseCaseDeps["documentStore"];
  private readonly epicSubtaskReplacementService: SetPlanUseCaseDeps["epicSubtaskReplacementService"];

  constructor(deps: SetPlanUseCaseDeps) {
    this.workflow = deps.workflow;
    this.documentStore = deps.documentStore;
    this.epicSubtaskReplacementService = deps.epicSubtaskReplacementService;
  }

  async execute(rawInput: unknown): Promise<unknown> {
    await this.workflow.ensureInitialized();
    const input = SetPlanInputSchema.parse(rawInput);
    const markdown = input.markdown.trim();

    const context = await this.workflow.resolveTaskContext(input.taskId);
    const { task, tasks } = context;

    const normalizedSubtasks = normalizePlanSubtasks(input.subtasks ?? []);
    let persistedDocument: { updatedAt: string; revision: number };
    let createdSubtaskIds: string[] = [];
    if (task.issueType === "epic") {
      // Epic subtask replacement must validate against a fresh snapshot, not the initial context.
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
      task: nextTask,
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
  workflow: Pick<OdtTaskWorkflowRuntimePort, "ensureInitialized" | "transitionTask">;
};

export class BuildBlockedUseCase implements OdtTaskStoreUseCase {
  private readonly workflow: TransitionTaskUseCaseDeps["workflow"];

  constructor(deps: TransitionTaskUseCaseDeps) {
    this.workflow = deps.workflow;
  }

  async execute(rawInput: unknown): Promise<unknown> {
    await this.workflow.ensureInitialized();
    const input = BuildBlockedInputSchema.parse(rawInput);
    const task = await this.workflow.transitionTask(input.taskId, "blocked");
    return {
      task,
      reason: input.reason,
    };
  }
}

export class BuildResumedUseCase implements OdtTaskStoreUseCase {
  private readonly workflow: TransitionTaskUseCaseDeps["workflow"];

  constructor(deps: TransitionTaskUseCaseDeps) {
    this.workflow = deps.workflow;
  }

  async execute(rawInput: unknown): Promise<unknown> {
    await this.workflow.ensureInitialized();
    const input = BuildResumedInputSchema.parse(rawInput);
    const task = await this.workflow.transitionTask(input.taskId, "in_progress");
    return { task };
  }
}

type BuildCompletedUseCaseDeps = {
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    "ensureInitialized" | "resolveTaskContext" | "refreshTaskContext" | "transitionTask"
  >;
};

export class BuildCompletedUseCase implements OdtTaskStoreUseCase {
  private readonly workflow: BuildCompletedUseCaseDeps["workflow"];

  constructor(deps: BuildCompletedUseCaseDeps) {
    this.workflow = deps.workflow;
  }

  async execute(rawInput: unknown): Promise<unknown> {
    await this.workflow.ensureInitialized();
    const input = BuildCompletedInputSchema.parse(rawInput);

    const context = await this.workflow.resolveTaskContext(input.taskId);
    const refreshedContext = await this.workflow.refreshTaskContext(context.task.id, context);
    const { task } = refreshedContext;

    const nextStatus = task.aiReviewEnabled ? "ai_review" : "human_review";
    const updatedTask = await this.workflow.transitionTask(task.id, nextStatus, refreshedContext);
    return {
      task: updatedTask,
      ...(input.summary ? { summary: input.summary } : {}),
    };
  }
}

type QaUseCaseDeps = {
  workflow: Pick<
    OdtTaskWorkflowRuntimePort,
    | "ensureInitialized"
    | "resolveTaskContext"
    | "assertTransitionAllowed"
    | "refreshTaskContext"
    | "transitionTask"
  >;
  documentStore: Pick<TaskDocumentPort, "appendQaReport">;
};

export class QaApprovedUseCase implements OdtTaskStoreUseCase {
  private readonly workflow: QaUseCaseDeps["workflow"];
  private readonly documentStore: QaUseCaseDeps["documentStore"];

  constructor(deps: QaUseCaseDeps) {
    this.workflow = deps.workflow;
    this.documentStore = deps.documentStore;
  }

  async execute(rawInput: unknown): Promise<unknown> {
    await this.workflow.ensureInitialized();
    const input = QaApprovedInputSchema.parse(rawInput);
    const context = await this.workflow.resolveTaskContext(input.taskId);
    const { task, tasks } = context;
    this.workflow.assertTransitionAllowed(task, tasks, "human_review");
    await this.documentStore.appendQaReport(task.id, input.reportMarkdown.trim(), "approved");
    const refreshedContext = await this.workflow.refreshTaskContext(task.id, context);
    const updatedTask = await this.workflow.transitionTask(
      task.id,
      "human_review",
      refreshedContext,
    );
    return { task: updatedTask };
  }
}

export class QaRejectedUseCase implements OdtTaskStoreUseCase {
  private readonly workflow: QaUseCaseDeps["workflow"];
  private readonly documentStore: QaUseCaseDeps["documentStore"];

  constructor(deps: QaUseCaseDeps) {
    this.workflow = deps.workflow;
    this.documentStore = deps.documentStore;
  }

  async execute(rawInput: unknown): Promise<unknown> {
    await this.workflow.ensureInitialized();
    const input = QaRejectedInputSchema.parse(rawInput);
    const context = await this.workflow.resolveTaskContext(input.taskId);
    const { task, tasks } = context;
    this.workflow.assertTransitionAllowed(task, tasks, "in_progress");
    await this.documentStore.appendQaReport(task.id, input.reportMarkdown.trim(), "rejected");
    const refreshedContext = await this.workflow.refreshTaskContext(task.id, context);
    const updatedTask = await this.workflow.transitionTask(
      task.id,
      "in_progress",
      refreshedContext,
    );
    return { task: updatedTask };
  }
}

export type CreateOdtTaskStoreUseCasesDeps = {
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
