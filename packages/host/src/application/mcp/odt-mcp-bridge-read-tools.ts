import {
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
  TASK_ARTIFACT_MCP_DEFAULT_READ_BYTES,
  workflowArtifactId,
  type TaskCard,
  type ArtifactReadRequest,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType, z } from "zod";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import {
  activeStatuses,
  findFreeTaskArtifact,
  isWorkflowArtifactCode,
  mapPublicTask,
  mapTaskSummary,
  missingFreeTaskArtifact,
  normalizeKey,
  parseResponse,
  parseToolInput,
  toMcpTaskArtifact,
} from "./odt-mcp-bridge-model";
import type {
  OdtMcpBridgeError,
  OdtMcpReadToolName,
  OdtMcpToolContext,
} from "./odt-mcp-bridge-tool-context";

const RESPONSE_SCHEMAS = ODT_HOST_BRIDGE_RESPONSE_SCHEMAS;

type OdtMcpReadToolResult = z.output<(typeof ODT_HOST_BRIDGE_RESPONSE_SCHEMAS)[OdtMcpReadToolName]>;

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
    const parsed = yield* parseToolInput("odt_read_task", ODT_TOOL_SCHEMAS.odt_read_task, input);
    const { repoPath, task } = yield* context.taskScopeForWorkspace(
      parsed.workspaceId ?? "",
      parsed.taskId,
    );
    const collection = yield* context.taskService.listTaskArtifacts({ repoPath, taskId: task.id });
    return yield* parseResponse("odt_read_task", RESPONSE_SCHEMAS.odt_read_task, {
      task: {
        ...mapPublicTask(task),
        qaVerdict: task.artifactSummary.qaReport.verdict,
        artifacts: collection.artifacts.map(toMcpTaskArtifact),
      },
    });
  });

const executeReadTaskArtifacts: OdtMcpReadToolHandler = (context, input) =>
  Effect.gen(function* () {
    const parsed = yield* parseToolInput(
      "odt_read_task_artifacts",
      ODT_TOOL_SCHEMAS.odt_read_task_artifacts,
      input,
    );
    const { repoPath, task } = yield* context.taskScopeForWorkspace(
      parsed.workspaceId ?? "",
      parsed.taskId,
    );
    const listedArtifacts = parsed.codes.some((code) => !isWorkflowArtifactCode(code))
      ? (yield* context.taskService.listTaskArtifacts({ repoPath, taskId: task.id })).artifacts
      : [];
    const selections = [];
    for (const code of parsed.codes) {
      if (isWorkflowArtifactCode(code)) {
        selections.push({ artifactId: workflowArtifactId(task.id, code), workflow: true });
        continue;
      }
      const artifact = findFreeTaskArtifact(listedArtifacts, code);
      if (artifact === undefined) return yield* missingFreeTaskArtifact(code);
      selections.push({ artifactId: artifact.artifactId, workflow: false });
    }
    // Overlap reads so independent image preview deadlines do not add up across a batch.
    const artifacts = yield* Effect.forEach(
      selections,
      ({ artifactId, workflow }) => {
        const request: ArtifactReadRequest = {
          repoPath,
          taskId: task.id,
          artifactId,
        };
        if (parsed.maxBytes !== undefined) request.maxBytes = parsed.maxBytes;
        else if (!workflow) request.maxBytes = TASK_ARTIFACT_MCP_DEFAULT_READ_BYTES;
        if (parsed.byteOffset !== undefined) request.byteOffset = parsed.byteOffset;
        if (parsed.expectedVersion !== undefined) request.expectedVersion = parsed.expectedVersion;
        return context.taskService.readTaskArtifact(request).pipe(
          Effect.map(({ artifact, ...chunk }) => ({
            ...chunk,
            artifact: toMcpTaskArtifact(artifact),
          })),
        );
      },
      { concurrency: 4 },
    );
    return yield* parseResponse(
      "odt_read_task_artifacts",
      RESPONSE_SCHEMAS.odt_read_task_artifacts,
      { artifacts },
    );
  });

const READ_TOOL_HANDLERS = {
  odt_search_tasks: executeSearchTasks,
  odt_read_task_assets: executeReadTaskAssets,
  odt_read_task: executeReadTask,
  odt_read_task_artifacts: executeReadTaskArtifacts,
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
