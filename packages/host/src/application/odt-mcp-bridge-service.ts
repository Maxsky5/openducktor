import {
  type BuildBlockedResult,
  type BuildCompletedResult,
  type BuildResumedResult,
  type CreateTaskResult,
  type GetWorkspacesResult,
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_MCP_TOOL_NAMES,
  ODT_TOOL_SCHEMAS,
  type OdtHostBridgeReady,
  type OdtPersistedDocument,
  type OdtToolName,
  type PublicTask,
  type PublicTaskSummaryTask,
  type QaApprovedResult,
  type QaRejectedResult,
  type SearchTasksResult,
  type SetPlanResult,
  type SetPullRequestResult,
  type SetSpecResult,
  type TaskCard,
  type TaskDocumentsRead,
  type TaskMetadataDocument,
  type TaskMetadataPayload,
  type TaskSummary,
  type WorkspaceScopedOdtToolName,
} from "@openducktor/contracts";
import type { TaskService } from "./task-service";
import type { TaskSyncService } from "./task-sync-service";
import type { WorkspaceSettingsService } from "./workspace-settings-service";

type OdtToolInput<Name extends OdtToolName> = ReturnType<(typeof ODT_TOOL_SCHEMAS)[Name]["parse"]>;

export type OdtMcpBridgeService = {
  ready(input?: unknown): Promise<OdtHostBridgeReady>;
  getWorkspaces(input?: unknown): Promise<GetWorkspacesResult>;
  invoke(toolName: WorkspaceScopedOdtToolName, input: unknown): Promise<unknown>;
};

export type CreateOdtMcpBridgeServiceInput = {
  taskService: TaskService;
  taskSyncService?: Pick<TaskSyncService, "publishExternalTaskCreated">;
  workspaceSettingsService: WorkspaceSettingsService;
};

const MAX_TASK_CANDIDATES = 5;

const normalizeKey = (value: string): string => value.trim().toLowerCase();

const sanitizeSlug = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const formatTaskRef = (task: TaskCard): string => `${task.id} (${task.title})`;

const ambiguousTaskError = (requested: string, matches: TaskCard[]): Error =>
  new Error(
    `Task identifier "${requested}" is ambiguous. Use exact task id. Candidates: ${matches
      .slice(0, MAX_TASK_CANDIDATES)
      .map(formatTaskRef)
      .join(", ")}`,
  );

const singleTaskMatch = (matches: TaskCard[]): TaskCard | null => {
  const [match] = matches;
  return matches.length === 1 && match ? match : null;
};

const resolveTaskReference = (tasks: TaskCard[], requestedTaskId: string): TaskCard => {
  const requestedLiteral = requestedTaskId.trim();
  if (!requestedLiteral) {
    throw new Error("Missing taskId.");
  }

  const requestedLower = normalizeKey(requestedLiteral);
  const requestedSlug = sanitizeSlug(requestedLiteral);
  const exact = tasks.find((task) => task.id === requestedLiteral);
  if (exact) {
    return exact;
  }

  const caseInsensitiveId = tasks.filter((task) => normalizeKey(task.id) === requestedLower);
  const singleCaseInsensitiveId = singleTaskMatch(caseInsensitiveId);
  if (singleCaseInsensitiveId) {
    return singleCaseInsensitiveId;
  }
  if (caseInsensitiveId.length > 1) {
    throw ambiguousTaskError(requestedTaskId, caseInsensitiveId);
  }

  if (requestedSlug) {
    const byIdSegment = tasks.filter((task) => {
      const normalizedId = normalizeKey(task.id);
      return (
        normalizedId === requestedSlug ||
        normalizedId.split("-").some((segment) => segment === requestedSlug)
      );
    });
    const singleIdSegment = singleTaskMatch(byIdSegment);
    if (singleIdSegment) {
      return singleIdSegment;
    }
    if (byIdSegment.length > 1) {
      throw ambiguousTaskError(requestedTaskId, byIdSegment);
    }
  }

  const byTitleExact = tasks.filter((task) => normalizeKey(task.title) === requestedLower);
  const singleTitleExact = singleTaskMatch(byTitleExact);
  if (singleTitleExact) {
    return singleTitleExact;
  }
  if (byTitleExact.length > 1) {
    throw ambiguousTaskError(requestedTaskId, byTitleExact);
  }

  if (requestedSlug) {
    const byTitleSlug = tasks.filter((task) => sanitizeSlug(task.title) === requestedSlug);
    const singleTitleSlug = singleTaskMatch(byTitleSlug);
    if (singleTitleSlug) {
      return singleTitleSlug;
    }
    if (byTitleSlug.length > 1) {
      throw ambiguousTaskError(requestedTaskId, byTitleSlug);
    }
  }

  const byTitleContains = tasks
    .filter((task) => {
      const titleLower = normalizeKey(task.title);
      const titleSlug = sanitizeSlug(task.title);
      return (
        (requestedLower && titleLower.includes(requestedLower)) ||
        (requestedSlug && titleSlug.includes(requestedSlug))
      );
    })
    .slice(0, MAX_TASK_CANDIDATES + 1);
  const singleTitleContains = singleTaskMatch(byTitleContains);
  if (singleTitleContains) {
    return singleTitleContains;
  }
  if (byTitleContains.length > 1) {
    throw ambiguousTaskError(requestedTaskId, byTitleContains);
  }

  const hints = tasks
    .filter((task) => {
      const idLower = normalizeKey(task.id);
      const titleLower = normalizeKey(task.title);
      const titleSlug = sanitizeSlug(task.title);
      return (
        (requestedLower &&
          (idLower.includes(requestedLower) || titleLower.includes(requestedLower))) ||
        (requestedSlug && (idLower.includes(requestedSlug) || titleSlug.includes(requestedSlug)))
      );
    })
    .slice(0, MAX_TASK_CANDIDATES);
  const candidates = hints.length > 0 ? hints : tasks.slice(0, MAX_TASK_CANDIDATES);
  if (candidates.length === 0) {
    throw new Error(`Task not found: ${requestedTaskId}.`);
  }

  throw new Error(
    `Task not found: ${requestedTaskId}. Candidate task ids: ${candidates
      .map(formatTaskRef)
      .join(", ")}`,
  );
};

const taskDocuments = (task: TaskCard): PublicTaskSummaryTask["documents"] => ({
  hasSpec: Boolean(task.documentSummary.spec.has),
  hasPlan: Boolean(task.documentSummary.plan.has),
  hasQaReport: Boolean(task.documentSummary.qaReport.has),
});

const mapPublicTask = (task: TaskCard): PublicTask => ({
  id: task.id,
  title: task.title,
  description: task.description ?? "",
  status: task.status,
  priority: task.priority,
  issueType: task.issueType,
  aiReviewEnabled: task.aiReviewEnabled,
  labels: task.labels,
  ...(task.targetBranch ? { targetBranch: task.targetBranch } : {}),
  createdAt: task.createdAt,
  updatedAt: task.updatedAt,
});

const mapTaskSummary = (task: TaskCard): TaskSummary => ({
  task: {
    ...mapPublicTask(task),
    qaVerdict: task.documentSummary.qaReport.verdict,
    documents: taskDocuments(task),
  },
});

const persistedDocument = (
  document: TaskMetadataDocument,
  operation: string,
): OdtPersistedDocument => {
  if (document.revision === undefined || document.revision < 1) {
    throw new Error(`Missing persisted document revision for ${operation}.`);
  }
  if (!document.updatedAt) {
    throw new Error(`Missing persisted document updatedAt for ${operation}.`);
  }

  return {
    markdown: document.markdown,
    updatedAt: document.updatedAt,
    revision: document.revision,
  };
};

const latestDocument = (document: TaskMetadataDocument) => ({
  markdown: document.markdown,
  updatedAt: document.updatedAt ?? null,
  ...(document.error ? { error: document.error } : {}),
});

const latestQaReport = (qaReport: TaskMetadataPayload["qaReport"]) =>
  qaReport
    ? {
        markdown: qaReport.markdown,
        updatedAt: qaReport.updatedAt ?? null,
        verdict: qaReport.verdict,
        ...(qaReport.error ? { error: qaReport.error } : {}),
      }
    : undefined;

const activeStatuses = new Set([
  "open",
  "spec_ready",
  "ready_for_dev",
  "in_progress",
  "blocked",
  "ai_review",
  "human_review",
]);

const directSubtaskIds = (tasks: TaskCard[], taskId: string): Set<string> =>
  new Set(tasks.filter((task) => task.parentId === taskId).map((task) => task.id));

const createdSubtaskIds = (before: Set<string>, after: TaskCard[], taskId: string): string[] =>
  after
    .filter((task) => task.parentId === taskId)
    .map((task) => task.id)
    .filter((taskId) => !before.has(taskId));

const parseToolInput = <Name extends OdtToolName>(
  toolName: Name,
  input: unknown,
): OdtToolInput<Name> => ODT_TOOL_SCHEMAS[toolName].parse(input) as OdtToolInput<Name>;

const parseResponse = <Name extends OdtToolName>(toolName: Name, output: unknown): unknown =>
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS[toolName].parse(output);

export const createOdtMcpBridgeService = ({
  taskService,
  taskSyncService,
  workspaceSettingsService,
}: CreateOdtMcpBridgeServiceInput): OdtMcpBridgeService => {
  const repoPathForWorkspace = async (workspaceId: string): Promise<string> => {
    const repoConfig = await workspaceSettingsService.getRepoConfig(workspaceId);
    return repoConfig.repoPath;
  };

  const tasksForWorkspace = async (workspaceId: string): Promise<TaskCard[]> => {
    const repoPath = await repoPathForWorkspace(workspaceId);
    return taskService.listTasks({ repoPath });
  };

  const taskForWorkspace = async (workspaceId: string, taskId: string): Promise<TaskCard> =>
    resolveTaskReference(await tasksForWorkspace(workspaceId), taskId);

  return {
    async ready() {
      return { bridgeVersion: 1, toolNames: [...ODT_MCP_TOOL_NAMES] };
    },
    async getWorkspaces(input) {
      parseToolInput("odt_get_workspaces", input ?? {});
      return parseResponse("odt_get_workspaces", {
        workspaces: await workspaceSettingsService.listWorkspaces(),
      }) as GetWorkspacesResult;
    },
    async invoke(toolName, input) {
      switch (toolName) {
        case "odt_create_task": {
          const parsed = parseToolInput(toolName, input);
          const repoPath = await repoPathForWorkspace(parsed.workspaceId ?? "");
          const created = await taskService.createTask({
            repoPath,
            input: {
              title: parsed.title,
              issueType: parsed.issueType,
              priority: parsed.priority,
              description: parsed.description,
              labels: parsed.labels,
              aiReviewEnabled: parsed.aiReviewEnabled,
            },
          });
          taskSyncService?.publishExternalTaskCreated(repoPath, created.id);
          return parseResponse(toolName, mapTaskSummary(created)) as CreateTaskResult;
        }
        case "odt_search_tasks": {
          const parsed = parseToolInput(toolName, input);
          const tasks = (await tasksForWorkspace(parsed.workspaceId ?? "")).filter((task) => {
            if (!activeStatuses.has(task.status)) {
              return false;
            }
            if (parsed.priority !== undefined && task.priority !== parsed.priority) {
              return false;
            }
            if (parsed.issueType !== undefined && task.issueType !== parsed.issueType) {
              return false;
            }
            if (parsed.status !== undefined && task.status !== parsed.status) {
              return false;
            }
            if (
              parsed.title !== undefined &&
              !normalizeKey(task.title).includes(normalizeKey(parsed.title))
            ) {
              return false;
            }
            if (parsed.tags !== undefined) {
              const labels = new Set(task.labels.map(normalizeKey));
              return parsed.tags.every((tag) => labels.has(normalizeKey(tag)));
            }
            return true;
          });
          const results = tasks.slice(0, parsed.limit).map(mapTaskSummary);
          return parseResponse(toolName, {
            results,
            limit: parsed.limit,
            totalCount: tasks.length,
            hasMore: tasks.length > results.length,
          }) as SearchTasksResult;
        }
        case "odt_read_task": {
          const parsed = parseToolInput(toolName, input);
          return parseResponse(
            toolName,
            mapTaskSummary(await taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId)),
          ) as TaskSummary;
        }
        case "odt_read_task_documents": {
          const parsed = parseToolInput(toolName, input);
          const repoPath = await repoPathForWorkspace(parsed.workspaceId ?? "");
          const task = await taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
          const metadata = await taskService.getTaskMetadata({ repoPath, taskId: task.id });
          const documents: TaskDocumentsRead["documents"] = {};
          if (parsed.includeSpec) {
            documents.spec = latestDocument(metadata.spec);
          }
          if (parsed.includePlan) {
            documents.implementationPlan = latestDocument(metadata.plan);
          }
          if (parsed.includeQaReport) {
            documents.latestQaReport = latestQaReport(metadata.qaReport);
          }
          return parseResponse(toolName, { documents }) as TaskDocumentsRead;
        }
        case "odt_set_spec": {
          const parsed = parseToolInput(toolName, input);
          const repoPath = await repoPathForWorkspace(parsed.workspaceId ?? "");
          const task = await taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
          const document = await taskService.setSpec({
            repoPath,
            taskId: task.id,
            markdown: parsed.markdown,
          });
          const updated = await taskForWorkspace(parsed.workspaceId ?? "", task.id);
          return parseResponse(toolName, {
            task: mapPublicTask(updated),
            document: persistedDocument(document, toolName),
          }) as SetSpecResult;
        }
        case "odt_set_plan": {
          const parsed = parseToolInput(toolName, input);
          const repoPath = await repoPathForWorkspace(parsed.workspaceId ?? "");
          const beforeTasks = await tasksForWorkspace(parsed.workspaceId ?? "");
          const task = resolveTaskReference(beforeTasks, parsed.taskId);
          const previousSubtaskIds = directSubtaskIds(beforeTasks, task.id);
          const document = await taskService.setPlan({
            repoPath,
            taskId: task.id,
            input: { markdown: parsed.markdown },
          });
          const afterTasks = await tasksForWorkspace(parsed.workspaceId ?? "");
          const updated = resolveTaskReference(afterTasks, task.id);
          return parseResponse(toolName, {
            task: mapPublicTask(updated),
            document: persistedDocument(document, toolName),
            createdSubtaskIds: createdSubtaskIds(previousSubtaskIds, afterTasks, task.id),
          }) as SetPlanResult;
        }
        case "odt_build_blocked": {
          const parsed = parseToolInput(toolName, input);
          const repoPath = await repoPathForWorkspace(parsed.workspaceId ?? "");
          const task = await taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
          const updated = await taskService.buildBlocked({
            repoPath,
            taskId: task.id,
            reason: parsed.reason,
          });
          return parseResponse(toolName, {
            task: mapPublicTask(updated),
            reason: parsed.reason.trim(),
          }) as BuildBlockedResult;
        }
        case "odt_build_resumed": {
          const parsed = parseToolInput(toolName, input);
          const repoPath = await repoPathForWorkspace(parsed.workspaceId ?? "");
          const task = await taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
          const updated = await taskService.buildResumed({ repoPath, taskId: task.id });
          return parseResponse(toolName, { task: mapPublicTask(updated) }) as BuildResumedResult;
        }
        case "odt_build_completed": {
          const parsed = parseToolInput(toolName, input);
          const repoPath = await repoPathForWorkspace(parsed.workspaceId ?? "");
          const task = await taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
          const updated = await taskService.buildCompleted({
            repoPath,
            taskId: task.id,
            input: parsed.summary === undefined ? {} : { summary: parsed.summary },
          });
          return parseResponse(toolName, {
            task: mapPublicTask(updated),
            ...(parsed.summary === undefined ? {} : { summary: parsed.summary }),
          }) as BuildCompletedResult;
        }
        case "odt_set_pull_request": {
          const parsed = parseToolInput(toolName, input);
          const repoConfig = await workspaceSettingsService.getRepoConfig(parsed.workspaceId ?? "");
          const task = await taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
          const pullRequest = await taskService.linkPullRequest({
            repoPath: repoConfig.repoPath,
            taskId: task.id,
            providerId: parsed.providerId,
            number: parsed.number,
          });
          const updated = await taskForWorkspace(parsed.workspaceId ?? "", task.id);
          return parseResponse(toolName, {
            task: mapPublicTask(updated),
            pullRequest,
          }) as SetPullRequestResult;
        }
        case "odt_qa_approved": {
          const parsed = parseToolInput(toolName, input);
          const repoPath = await repoPathForWorkspace(parsed.workspaceId ?? "");
          const task = await taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
          const updated = await taskService.qaApproved({
            repoPath,
            taskId: task.id,
            reportMarkdown: parsed.reportMarkdown,
          });
          return parseResponse(toolName, { task: mapPublicTask(updated) }) as QaApprovedResult;
        }
        case "odt_qa_rejected": {
          const parsed = parseToolInput(toolName, input);
          const repoPath = await repoPathForWorkspace(parsed.workspaceId ?? "");
          const task = await taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
          const updated = await taskService.qaRejected({
            repoPath,
            taskId: task.id,
            reportMarkdown: parsed.reportMarkdown,
          });
          return parseResponse(toolName, { task: mapPublicTask(updated) }) as QaRejectedResult;
        }
      }
    },
  };
};
