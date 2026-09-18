import {
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
  type ReadTaskAssetsResult,
  type SearchTasksResult,
  type TaskCard,
  type TaskDocumentsRead,
  type TaskSummary,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType } from "zod";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import {
  activeStatuses,
  latestDocument,
  latestQaReport,
  mapTaskSummary,
  normalizeKey,
  parseResponse,
  parseToolInput,
} from "./odt-mcp-bridge-model";
import type {
  OdtMcpBridgeError,
  OdtMcpReadToolName,
  OdtMcpToolContext,
} from "./odt-mcp-bridge-tool-context";

const RESPONSE_SCHEMAS = ODT_HOST_BRIDGE_RESPONSE_SCHEMAS;

type OdtMcpReadToolResult =
  | ReadTaskAssetsResult
  | SearchTasksResult
  | TaskDocumentsRead
  | TaskSummary;

type OdtMcpReadToolHandler = (
  context: OdtMcpToolContext,
  input: JSONType,
) => Effect.Effect<OdtMcpReadToolResult, OdtMcpBridgeError>;

export const executeOdtMcpReadTool = (
  context: OdtMcpToolContext,
  toolName: OdtMcpReadToolName,
  input: JSONType,
): Effect.Effect<OdtMcpReadToolResult, OdtMcpBridgeError> =>
  READ_TOOL_HANDLERS[toolName](context, input);

const executeSearchTasks: OdtMcpReadToolHandler = (context, input) =>
  Effect.gen(function* () {
    const { tasksForWorkspace } = context;
    const parsed = yield* parseToolInput(
      "odt_search_tasks",
      ODT_TOOL_SCHEMAS.odt_search_tasks,
      input,
    );
    const tasks = (yield* tasksForWorkspace(parsed.workspaceId ?? "")).filter((task) => {
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
    tasks.sort(compareTaskSearchResults);
    const results = tasks.slice(0, parsed.limit).map(mapTaskSummary);
    return yield* parseResponse("odt_search_tasks", RESPONSE_SCHEMAS.odt_search_tasks, {
      results,
      limit: parsed.limit,
      totalCount: tasks.length,
      hasMore: tasks.length > results.length,
    });
  });

const executeReadTaskAssets: OdtMcpReadToolHandler = (context, input) =>
  Effect.gen(function* () {
    const { taskAssetReadService, taskForWorkspace } = context;
    const parsed = yield* parseToolInput(
      "odt_read_task_assets",
      ODT_TOOL_SCHEMAS.odt_read_task_assets,
      input,
    );
    const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
    const batch = yield* taskAssetReadService
      .readBatch({
        workspaceId: parsed.workspaceId ?? "",
        taskId: task.id,
        scope: "description",
        assetIds: parsed.assetIds,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new HostOperationError({
              operation: "odt_mcp_bridge.read_task_assets",
              message: cause.message,
              cause,
              details: {
                taskId: task.id,
                assetIds: parsed.assetIds,
                failedPhase: cause.failedPhase,
              },
            }),
        ),
      );
    if (batch.kind === "missing") {
      return yield* new HostValidationError({
        field: "assetIds",
        message: "One or more requested task description assets were not found.",
        details: {
          field: "assetIds",
          taskId: task.id,
          missingAssetIds: batch.assetIds,
        },
      });
    }
    if (batch.kind === "too_large") {
      return yield* new HostValidationError({
        field: "assetIds",
        message: "Requested task description assets exceed the per-call byte limit.",
        details: {
          field: "assetIds",
          taskId: task.id,
          requestedBytes: batch.requestedBytes,
          maxBytes: batch.maxBytes,
        },
      });
    }
    return yield* parseResponse("odt_read_task_assets", RESPONSE_SCHEMAS.odt_read_task_assets, {
      assets: batch.assets.map(({ assetId, asset }) => ({
        assetId,
        mediaType: asset.mediaType,
        byteSize: asset.bytes.byteLength,
        dataBase64: Buffer.from(asset.bytes).toString("base64"),
      })),
    });
  });

const executeReadTask: OdtMcpReadToolHandler = (context, input) =>
  Effect.gen(function* () {
    const { taskForWorkspace } = context;
    const parsed = yield* parseToolInput("odt_read_task", ODT_TOOL_SCHEMAS.odt_read_task, input);
    return yield* parseResponse(
      "odt_read_task",
      RESPONSE_SCHEMAS.odt_read_task,
      mapTaskSummary(yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId)),
    );
  });

const executeReadTaskDocuments: OdtMcpReadToolHandler = (context, input) =>
  Effect.gen(function* () {
    const { repoPathForWorkspace, taskForWorkspace, taskService } = context;
    const parsed = yield* parseToolInput(
      "odt_read_task_documents",
      ODT_TOOL_SCHEMAS.odt_read_task_documents,
      input,
    );
    const repoPath = yield* repoPathForWorkspace(parsed.workspaceId ?? "");
    const task = yield* taskForWorkspace(parsed.workspaceId ?? "", parsed.taskId);
    const metadata = yield* taskService.getTaskMetadata({ repoPath, taskId: task.id });
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
    return yield* parseResponse(
      "odt_read_task_documents",
      RESPONSE_SCHEMAS.odt_read_task_documents,
      {
        documents,
      },
    );
  });

const READ_TOOL_HANDLERS = {
  odt_search_tasks: executeSearchTasks,
  odt_read_task_assets: executeReadTaskAssets,
  odt_read_task: executeReadTask,
  odt_read_task_documents: executeReadTaskDocuments,
} satisfies Record<OdtMcpReadToolName, OdtMcpReadToolHandler>;

const compareTaskSearchResults = (
  left: Pick<TaskCard, "id" | "updatedAt">,
  right: Pick<TaskCard, "id" | "updatedAt">,
): number => {
  const updatedAtOrder = right.updatedAt.localeCompare(left.updatedAt);
  if (updatedAtOrder !== 0) {
    return updatedAtOrder;
  }
  return left.id.localeCompare(right.id);
};
