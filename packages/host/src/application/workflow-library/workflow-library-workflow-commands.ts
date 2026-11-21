import { TASK_CLOSED_STATE, type WorkflowPublishResult } from "@openducktor/contracts";
import {
  BUILTIN_WORKFLOW_ID,
  checkWorkflowDocument,
  definitionOfDocument,
  newWorkflowDocument,
  nextVersionPrompts,
  workflowIdFromName,
} from "@openducktor/workflows";
import { Clock, Effect } from "effect";
import { planWorkflowImport } from "./workflow-import-plan";
import {
  copyOf,
  errorCount,
  importHostState,
  type Inputs,
  invalid,
  joinNames,
  parseFile,
  readCheckContext,
  readMoveTarget,
  requireCustomWorkflow,
  requireDraft,
  requireVersion,
  type Result,
  sourceDocument,
  openTaskCountText,
  type WorkflowLibraryServiceDeps,
} from "./workflow-library-support";
import { selectedTaskMoveFailure } from "./workflow-task-moves";
import type { WorkflowLibraryReads } from "../../ports/workflow-library-store-port";

/**
 * The workflow mutations. Each runs in one store write transaction and reads its values after the
 * write lock. Each commit other than a draft save sends the library event.
 */
export const createWorkflowCommands = ({
  store,
  runningTaskSessions,
  publishMovedTasks,
  publishLibraryChanged,
}: WorkflowLibraryServiceDeps) => {
  const committed = <A>(work: Result<A>): Result<A> =>
    work.pipe(Effect.tap(() => Effect.sync(publishLibraryChanged)));

  const create = (input: Inputs["workflow_create"]): Result<{ workflowId: string }> =>
    committed(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        return yield* store.transact("workflow-library.create", (transaction) =>
          Effect.gen(function* () {
            const workflows = yield* transaction.workflows();
            const document =
              "from" in input
                ? copyOf(
                    yield* sourceDocument(transaction, input.from),
                    workflows,
                    input.name?.trim(),
                  )
                : newWorkflowDocument(
                    workflowIdFromName(
                      input.name,
                      new Set([BUILTIN_WORKFLOW_ID, ...workflows.map((row) => row.workflowId)]),
                    ),
                    input.name,
                  );
            const workflowId = document.definition.id;
            yield* transaction.createWorkflow({ workflowId, nowMs, document });
            return { workflowId };
          }),
        );
      }),
    );

  /**
   * Saves a draft. Problems never block a save, and the last save wins. A changed workflow ID
   * renames a workflow without a version to a free ID.
   */
  const saveDraft = (input: Inputs["workflow_draft_save"]): Result<{ workflowId: string }> =>
    Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      return yield* store.transact("workflow-library.draft-save", (transaction) =>
        Effect.gen(function* () {
          const row = yield* requireCustomWorkflow(transaction, input.workflowId);
          const workflowId = input.document.definition.id;
          if (workflowId !== row.workflowId) {
            if (row.latestVersion !== null)
              return yield* invalid(
                `The ID of workflow "${row.workflowId}" is fixed after its first publication. Set the workflow ID back to "${row.workflowId}".`,
                "definition.id",
              );
            if (workflowId === BUILTIN_WORKFLOW_ID || (yield* transaction.workflow(workflowId)))
              return yield* invalid(
                `Workflow ID "${workflowId}" is already used on this host. Pick another ID.`,
                "definition.id",
              );
            yield* transaction.renameWorkflow({ from: row.workflowId, to: workflowId });
          }
          yield* transaction.saveDraft({ workflowId, nowMs, document: input.document });
          return { workflowId };
        }),
      );
    });

  /** Deletes the draft. A workflow without a version goes with its draft. */
  const discardDraft = (
    input: Inputs["workflow_draft_discard"],
  ): Result<{ workflowDeleted: boolean }> =>
    committed(
      store.transact("workflow-library.draft-discard", (transaction) =>
        Effect.gen(function* () {
          const row = yield* requireCustomWorkflow(transaction, input.workflowId);
          if (row.latestVersion === null) {
            yield* transaction.deleteWorkflow(row.workflowId);
            return { workflowDeleted: true };
          }
          yield* transaction.deleteDraft(row.workflowId);
          return { workflowDeleted: false };
        }),
      ),
    );

  /**
   * Publishes the draft as the next version. A problem against the current database state returns
   * the problems and changes nothing. A selected task that can no longer move fails the whole
   * publication.
   */
  const publish = (input: Inputs["workflow_publish"]): Result<WorkflowPublishResult> =>
    Effect.gen(function* () {
      const nowMs = yield* Clock.currentTimeMillis;
      const running = yield* runningTaskSessions();
      const result = yield* store.transact("workflow-library.publish", (transaction) =>
        Effect.gen(function* () {
          const row = yield* requireCustomWorkflow(transaction, input.workflowId);
          const draft = yield* requireDraft(transaction, row);
          const targetVersion = (row.latestVersion ?? 0) + 1;
          const tasks = yield* transaction.tasksBelowVersion(row.workflowId, targetVersion);
          const problems = checkWorkflowDocument(
            draft.document,
            yield* readCheckContext(transaction, row),
          );
          if (errorCount(problems) > 0) return { outcome: "problems" as const, problems };
          const moveFailure = selectedTaskMoveFailure(
            input.moveTasks,
            tasks,
            draft.document.definition,
            running,
          );
          if (moveFailure !== null) return yield* invalid(moveFailure, "moveTasks");

          const previousPrompts =
            row.latestVersion === null
              ? []
              : (yield* requireVersion(transaction, row.workflowId, row.latestVersion)).document
                  .prompts;
          yield* transaction.insertVersion({
            workflowId: row.workflowId,
            version: targetVersion,
            nowMs,
            document: {
              definition: definitionOfDocument(draft.document, targetVersion),
              prompts: nextVersionPrompts(draft.document.prompts, previousPrompts),
              layout: structuredClone(draft.document.layout),
            },
          });
          yield* transaction.deleteDraft(row.workflowId);
          const moved = yield* transaction.moveTasks({
            workflowId: row.workflowId,
            version: targetVersion,
            tasks: input.moveTasks,
          });
          return { outcome: "published" as const, version: targetVersion, moved };
        }),
      );
      if (result.outcome === "problems") return result;
      publishLibraryChanged();
      if (result.moved.length > 0) yield* publishMovedTasks(result.moved);
      return { outcome: "published" as const, version: result.version };
    });

  /** Moves tasks of older versions to the latest version, with the move rule of publication. */
  const moveTasks = (input: Inputs["workflow_tasks_move"]): Result<{ moved: number }> =>
    Effect.gen(function* () {
      const running = yield* runningTaskSessions();
      const moved = yield* store.transact("workflow-library.tasks-move", (transaction) =>
        Effect.gen(function* () {
          const row = yield* requireCustomWorkflow(transaction, input.workflowId);
          const { target, version: targetVersion } = yield* readMoveTarget(
            transaction,
            row,
            "latest",
          );
          const tasks = yield* transaction.tasksBelowVersion(row.workflowId, targetVersion);
          const moveFailure = selectedTaskMoveFailure(input.tasks, tasks, target, running);
          if (moveFailure !== null) return yield* invalid(moveFailure, "tasks");
          return yield* transaction.moveTasks({
            workflowId: row.workflowId,
            version: targetVersion,
            tasks: input.tasks,
          });
        }),
      );
      publishLibraryChanged();
      if (moved.length > 0) yield* publishMovedTasks(moved);
      return { moved: moved.length };
    });

  /**
   * Deletes a custom workflow, its draft, and its settings. It fails while the workflow is the
   * default or an open task uses it. Closed tasks keep the versions that they use, so the workflow
   * keeps its row and versions while closed tasks exist.
   */
  const deleteWorkflow = (input: Inputs["workflow_delete"]): Result<void> =>
    committed(
      Effect.gen(function* () {
        const nowMs = yield* Clock.currentTimeMillis;
        return yield* store.transact("workflow-library.delete", (transaction) =>
          Effect.gen(function* () {
            const row = yield* requireCustomWorkflow(transaction, input.workflowId);
            const [defaultWorkflowId, used] = yield* Effect.all([
              transaction.defaultWorkflowId(),
              transaction.tasksOfWorkflow(row.workflowId),
            ]);
            const isDefault = defaultWorkflowId === row.workflowId;
            const openCounts = new Map<string, number>();
            for (const { repoName, status } of used)
              if (status !== TASK_CLOSED_STATE)
                openCounts.set(repoName, (openCounts.get(repoName) ?? 0) + 1);
            const usedBy = [...openCounts].map(
              ([repoName, count]) => `${repoName} (${openTaskCountText(count)})`,
            );
            if (isDefault || usedBy.length > 0) {
              const reasons = [
                isDefault ? "It is the default workflow. Make another workflow the default." : "",
                usedBy.length > 0
                  ? `Open tasks use it in: ${joinNames(usedBy)}. Close or delete them.`
                  : "",
              ].filter(Boolean);
              return yield* invalid(
                `Workflow "${row.workflowId}" cannot be deleted yet. ${reasons.join(" ")}`,
              );
            }
            if (used.length > 0)
              yield* transaction.deleteWorkflowKeepingVersions({
                workflowId: row.workflowId,
                nowMs,
              });
            else yield* transaction.deleteWorkflow(row.workflowId);
          }),
        );
      }),
    );

  /** Creates the custom roles and the draft of a file in one transaction. It never publishes. */
  const importCommit = (input: Inputs["workflow_import_commit"]): Result<{ workflowId: string }> =>
    committed(
      Effect.gen(function* () {
        const file = yield* parseFile(input.text);
        const nowMs = yield* Clock.currentTimeMillis;
        return yield* store.transact("workflow-library.import", (transaction) =>
          Effect.gen(function* () {
            const planned = planWorkflowImport(file, yield* importHostState(transaction), {
              target: input.target,
              roleChoices: input.roleChoices,
            });
            if (planned.outcome === "rejected") return yield* invalid(planned.message, "text");
            const { plan } = planned;
            for (const role of plan.newRoles) yield* transaction.saveRole({ role, nowMs });
            if (plan.updatesExisting)
              yield* transaction.saveDraft({
                workflowId: plan.workflowId,
                nowMs,
                document: plan.document,
              });
            else
              yield* transaction.createWorkflow({
                workflowId: plan.workflowId,
                nowMs,
                document: plan.document,
              });
            return { workflowId: plan.workflowId };
          }),
        );
      }),
    );

  /** Fails unless the workflow is the built-in workflow or a listed custom workflow. */
  const requireWorkflow = (reads: WorkflowLibraryReads, workflowId: string) =>
    workflowId === BUILTIN_WORKFLOW_ID
      ? Effect.succeed(null)
      : requireCustomWorkflow(reads, workflowId).pipe(Effect.map((row) => row));

  /**
   * Sets which workspaces can use a workflow. The default workflow stays available to every
   * workspace, and a rule lists only workspaces of this host.
   */
  const setAvailability = (input: Inputs["workflow_availability_set"]): Result<void> =>
    committed(
      store.transact("workflow-library.availability", (transaction) =>
        Effect.gen(function* () {
          yield* requireWorkflow(transaction, input.workflowId);
          const { availability } = input;
          if (availability.mode === "all")
            return yield* transaction.setAvailability({ workflowId: input.workflowId, rule: null });
          if ((yield* transaction.defaultWorkflowId()) === input.workflowId)
            return yield* invalid(
              `Workflow "${input.workflowId}" is the default workflow, so every repository must be able to use it. Make another workflow the default first.`,
              "availability",
            );
          const known = new Set(yield* transaction.workspaceIds());
          const workspaceIds = [...new Set(availability.workspaceIds)];
          const unknown = workspaceIds.find((workspaceId) => !known.has(workspaceId));
          if (unknown !== undefined)
            return yield* invalid(
              `Repository "${unknown}" does not exist on this host. Reload the repository list.`,
              "availability",
            );
          yield* transaction.setAvailability({
            workflowId: input.workflowId,
            rule: { mode: availability.mode, workspaceIds },
          });
        }),
      ),
    );

  /**
   * Makes a workflow the workflow of new tasks. It needs a published version and the availability
   * of every workspace.
   */
  const setDefault = (input: Inputs["workflow_default_set"]): Result<void> =>
    committed(
      store.transact("workflow-library.default", (transaction) =>
        Effect.gen(function* () {
          const row = yield* requireWorkflow(transaction, input.workflowId);
          if (row && row.latestVersion === null)
            return yield* invalid(
              `Workflow "${row.workflowId}" has no published version. Publish a version before you make it the default.`,
              "workflowId",
            );
          const rules = yield* transaction.availability();
          if (rules.some(({ workflowId }) => workflowId === input.workflowId))
            return yield* invalid(
              `Workflow "${input.workflowId}" is not available to every repository. Make it available to all repositories before you make it the default.`,
              "workflowId",
            );
          yield* transaction.setDefaultWorkflow(input.workflowId);
        }),
      ),
    );

  return {
    create,
    saveDraft,
    discardDraft,
    publish,
    moveTasks,
    deleteWorkflow,
    importCommit,
    setAvailability,
    setDefault,
  };
};
