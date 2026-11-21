import {
  TASK_CLOSED_STATE,
  type WorkflowAvailability,
  type WorkflowDocument,
  type WorkflowDocumentDefinition,
  type WorkflowDocumentView,
  type WorkflowExport,
  type WorkflowImportPreview,
  type WorkflowLibrary,
  type WorkflowRoleImpact,
  type WorkflowTaskGroup,
  type WorkflowTaskMoveGroup,
  type WorkflowTaskUse,
  type WorkflowVersionSummary,
} from "@openducktor/contracts";
import {
  BUILTIN_ROLES,
  BUILTIN_WORKFLOW_ID,
  builtinWorkflowDocument,
  checkWorkflowDocument,
  specPlanBuildWorkflow,
  versionToDocument,
  withBuiltinSharedFields,
} from "@openducktor/workflows";
import { Effect } from "effect";
import { exportWorkflowFile, parseWorkflowFile } from "./workflow-file-codec";
import { previewWorkflowImport } from "./workflow-import-plan";
import {
  builtinName,
  checkContext,
  draftCounts,
  importHostState,
  type Inputs,
  invalid,
  issueTypeOf,
  libraryStateOf,
  nameOf,
  overviewOf,
  readMoveTarget,
  requireCustomWorkflow,
  requireLatestVersion,
  requireVersion,
  type Result,
  type WorkflowLibraryServiceDeps,
} from "./workflow-library-support";
import { taskMoveGroups } from "./workflow-task-moves";

/** The library reads. They change nothing. */
export const createWorkflowLibraryQueries = ({
  store,
  runningTaskSessions,
}: WorkflowLibraryServiceDeps) => {
  /**
   * The draft check counts of each workflow, with the key of the draft and check inputs that gave
   * them. A list checks again only a draft whose key changed.
   */
  const draftChecks = new Map<string, { key: string; counts: ReturnType<typeof draftCounts> }>();

  const library = (): Result<WorkflowLibrary> =>
    store.read("workflow-library.list", (reads) =>
      Effect.gen(function* () {
        const [workflows, drafts, latestVersions, roles, rules, defaultWorkflowId] =
          yield* Effect.all([
            reads.workflows(),
            reads.drafts(),
            reads.latestVersions(),
            reads.roles(),
            reads.availability(),
            reads.defaultWorkflowId(),
          ]);
        const draftById = new Map(drafts.map((draft) => [draft.workflowId, draft.document]));
        // Every input of a draft check other than the draft: workflow IDs, versions, and roles.
        const checkInputs = JSON.stringify([
          workflows.map(({ workflowId, latestVersion, deletedAtMs }) => [
            workflowId,
            latestVersion,
            deletedAtMs,
          ]),
          latestVersions.map(({ workflowId, version, publishedAtMs }) => [
            workflowId,
            version,
            publishedAtMs,
          ]),
          roles.map(({ role, updatedAtMs }) => [role.id, updatedAtMs]),
        ]);
        const checkDraft = (row: (typeof workflows)[number], draft: WorkflowDocument) => {
          const key = `${row.draftUpdatedAtMs}:${checkInputs}`;
          const kept = draftChecks.get(row.workflowId);
          if (kept?.key === key) return kept.counts;
          const counts = draftCounts(
            checkWorkflowDocument(
              draft,
              checkContext(row.workflowId, row.latestVersion, workflows, latestVersions, roles),
            ),
          );
          draftChecks.set(row.workflowId, { key, counts });
          return counts;
        };
        for (const workflowId of draftChecks.keys())
          if (!draftById.has(workflowId)) draftChecks.delete(workflowId);
        const latestById = new Map(latestVersions.map((version) => [version.workflowId, version]));
        const ruleOf = new Map(rules.map((rule) => [rule.workflowId, rule]));
        const availabilityOf = (workflowId: string): WorkflowAvailability => {
          const rule = ruleOf.get(workflowId);
          return rule ? { mode: rule.mode, workspaceIds: [...rule.workspaceIds] } : { mode: "all" };
        };
        // A deleted workflow keeps its row for its closed tasks. The library does not show it.
        const listed = workflows.filter(({ deletedAtMs }) => deletedAtMs === null);
        const custom = listed
          .map((row) => {
            const draft = draftById.get(row.workflowId);
            const shown = draft?.definition ?? latestById.get(row.workflowId)?.document.definition;
            return {
              id: row.workflowId,
              name: nameOf(row.workflowId, draftById, latestById),
              ...(shown ? overviewOf(shown) : { states: [], transitionCount: 0 }),
              source: "custom" as const,
              latestVersion: row.latestVersion,
              draft: draft ? checkDraft(row, draft) : null,
              availability: availabilityOf(row.workflowId),
            };
          })
          .sort(
            (left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id),
          );

        const boundRoles = new Map<string, ReadonlySet<string>>([
          [
            BUILTIN_WORKFLOW_ID,
            new Set(specPlanBuildWorkflow.definition.roles.map(({ id }) => id)),
          ],
          ...listed.map(({ workflowId }): [string, ReadonlySet<string>] => [
            workflowId,
            new Set(
              [
                ...(draftById.get(workflowId)?.definition.roles ?? []),
                ...(latestById.get(workflowId)?.document.definition.roles ?? []),
              ].map(({ id }) => id),
            ),
          ]),
        ]);
        const workflowIdsOf = (roleId: string) =>
          [...boundRoles]
            .filter(([, bound]) => bound.has(roleId))
            .map(([workflowId]) => workflowId);

        return {
          workflows: [
            {
              id: BUILTIN_WORKFLOW_ID,
              name: builtinName,
              ...overviewOf(builtinWorkflowDocument().definition),
              source: "builtin" as const,
              latestVersion: null,
              draft: null,
              availability: availabilityOf(BUILTIN_WORKFLOW_ID),
            },
            ...custom,
          ],
          roles: [
            ...BUILTIN_ROLES.map((role) => ({
              role,
              source: "builtin" as const,
              workflowIds: workflowIdsOf(role.id),
            })),
            ...roles.map(({ role }) => ({
              role,
              source: "custom" as const,
              workflowIds: workflowIdsOf(role.id),
            })),
          ],
          defaultWorkflowId,
        };
      }),
    );

  const document = (input: Inputs["workflow_document_get"]): Result<WorkflowDocumentView> =>
    store.read("workflow-library.document", (reads) =>
      Effect.gen(function* () {
        if (input.workflowId === BUILTIN_WORKFLOW_ID) {
          if (input.version !== undefined)
            return yield* invalid(
              `The built-in workflow "${builtinName}" has no versions. Open it without a version.`,
            );
          return {
            workflowId: BUILTIN_WORKFLOW_ID,
            source: "builtin" as const,
            kind: "version" as const,
            version: null,
            latestVersion: null,
            document: builtinWorkflowDocument(),
          };
        }
        const row = yield* requireCustomWorkflow(reads, input.workflowId);
        const view = {
          workflowId: row.workflowId,
          source: "custom" as const,
          latestVersion: row.latestVersion,
        };
        if (input.version === undefined) {
          const draft = yield* reads.draft(row.workflowId);
          if (draft)
            return { ...view, kind: "draft" as const, version: null, document: draft.document };
        }
        const version =
          input.version === undefined
            ? yield* requireLatestVersion(reads, row)
            : yield* requireVersion(reads, row.workflowId, input.version);
        return {
          ...view,
          kind: "version" as const,
          version: version.version,
          document: versionToDocument(version.document),
        };
      }),
    );

  const versions = (input: Inputs["workflow_versions_list"]): Result<WorkflowVersionSummary[]> =>
    store.read("workflow-library.versions", (reads) =>
      Effect.gen(function* () {
        const row = yield* requireCustomWorkflow(reads, input.workflowId);
        const summaries = yield* reads.versions(row.workflowId);
        return summaries.map(({ version, publishedAtMs, taskCount }) => ({
          version,
          publishedAt: new Date(publishedAtMs).toISOString(),
          taskCount,
        }));
      }),
    );

  /**
   * The tasks that use a workflow. Open tasks stop its delete; they come by repository, each with
   * its type and state in its version. A delete keeps the versions of closed tasks.
   */
  const taskUse = (input: Inputs["workflow_task_use_get"]): Result<WorkflowTaskUse> =>
    store.read("workflow-library.task-use", (reads) =>
      Effect.gen(function* () {
        const row = yield* requireCustomWorkflow(reads, input.workflowId);
        const used = yield* reads.tasksOfWorkflow(row.workflowId);
        const open = used.filter(({ status }) => status !== TASK_CLOSED_STATE);
        const definitions = new Map<number, WorkflowDocumentDefinition>();
        for (const version of new Set(open.map((task) => task.version))) {
          const stored = yield* requireVersion(reads, row.workflowId, version);
          definitions.set(version, withBuiltinSharedFields(stored.document.definition));
        }
        const groups = new Map<string, WorkflowTaskGroup>();
        for (const task of open) {
          const definition = definitions.get(task.version)!;
          const state = definition.states.find(({ id }) => id === task.status);
          const issueType = definition.issueTypes.find(({ id }) => id === task.issueType);
          if (!state || !issueType)
            return yield* invalid(
              `Task "${task.taskId}" has ${state ? `issue type "${task.issueType}"` : `state "${task.status}"`}, which version ${task.version} of workflow "${row.workflowId}" does not define. Move the task to a version that defines it.`,
            );
          const group = groups.get(task.workspaceId) ?? {
            workspaceId: task.workspaceId,
            repoName: task.repoName,
            tasks: [],
          };
          group.tasks.push({
            taskId: task.taskId,
            title: task.title,
            version: task.version,
            issueType: issueTypeOf(issueType),
            state: libraryStateOf(state),
          });
          groups.set(task.workspaceId, group);
        }
        return { openTasks: [...groups.values()], closedTaskCount: used.length - open.length };
      }),
    );

  const taskMoves = (input: Inputs["workflow_task_moves_get"]): Result<WorkflowTaskMoveGroup[]> =>
    Effect.gen(function* () {
      const running = yield* runningTaskSessions();
      const { target, tasks } = yield* store.read("workflow-library.task-moves", (reads) =>
        Effect.gen(function* () {
          const row = yield* requireCustomWorkflow(reads, input.workflowId);
          const { target, version } = yield* readMoveTarget(reads, row, input.target);
          return { target, tasks: yield* reads.tasksBelowVersion(row.workflowId, version) };
        }),
      );
      return taskMoveGroups(tasks, target, running);
    });

  const roleImpact = (input: Inputs["workflow_role_impact_get"]): Result<WorkflowRoleImpact> =>
    Effect.gen(function* () {
      const running = yield* runningTaskSessions();
      const workflows = yield* store.read("workflow-library.role-impact", (reads) =>
        Effect.gen(function* () {
          const bindings = yield* reads.roleBindings(input.roleId);
          return yield* Effect.forEach(
            bindings.filter(({ versions: bound }) => bound.length > 0),
            ({ workflowId, versions: bound }) =>
              requireVersion(reads, workflowId, bound.at(-1)!).pipe(
                Effect.map((version) => ({
                  id: workflowId,
                  name: version.document.definition.label,
                })),
              ),
          );
        }),
      );
      return {
        workflows,
        runningSessions: running.filter(({ role }) => role === input.roleId).length,
      };
    });

  const exportWorkflow = (input: Inputs["workflow_export"]): Result<WorkflowExport> =>
    store.read("workflow-library.export", (reads) =>
      Effect.gen(function* () {
        if (input.workflowId === BUILTIN_WORKFLOW_ID)
          return yield* invalid(
            `The built-in workflow "${builtinName}" has no export. Duplicate it, publish the copy, then export the copy.`,
          );
        const row = yield* requireCustomWorkflow(reads, input.workflowId);
        const latest = yield* requireLatestVersion(reads, row);
        const roles = yield* reads.roles();
        return exportWorkflowFile(
          latest.document,
          roles.map(({ role }) => role),
        );
      }),
    );

  const importPreview = (input: Inputs["workflow_import_preview"]): Result<WorkflowImportPreview> =>
    Effect.gen(function* () {
      const parsed = parseWorkflowFile(input.text);
      if (!parsed.ok)
        return {
          outcome: "invalid" as const,
          message: parsed.message,
          line: parsed.line,
          column: parsed.column,
        };
      const state = yield* store.read("workflow-library.import-preview", importHostState);
      return previewWorkflowImport(parsed.file, state);
    });

  return {
    library,
    document,
    versions,
    taskUse,
    taskMoves,
    roleImpact,
    exportWorkflow,
    importPreview,
  };
};
