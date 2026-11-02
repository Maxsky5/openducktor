import {
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
  workflowArtifactId,
  type ArtifactReadRequest,
} from "@openducktor/contracts";
import { Effect } from "effect";
import type { JSONType, z } from "zod";
import { HostOperationError, HostValidationError } from "../../effect/host-errors";
import {
  findFreeTaskArtifact,
  publicWorkflowArtifacts,
  mapPublicTask,
  mapTaskSummary,
  missingFreeTaskArtifact,
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
    const parsed = yield* parseToolInput(
      "odt_search_tasks",
      ODT_TOOL_SCHEMAS.odt_search_tasks,
      input,
    );
    const scope = yield* context.workspaceScopeForWorkspace(parsed.workspaceId ?? "");
    // A filter value is valid when a task workflow of the host declares it.
    const { workflows } = context.taskWorkflows;
    const issueTypes = [...new Set(workflows.flatMap(({ issueTypes }) => issueTypes))];
    if (parsed.issueType !== undefined && !issueTypes.includes(parsed.issueType)) {
      return yield* new HostValidationError({
        field: "issueType",
        message: `Issue type ${parsed.issueType} is not in a task workflow. Use ${issueTypes.join(", ")}.`,
        details: { issueType: parsed.issueType },
      });
    }
    const openStates = workflows.flatMap(({ definition }) =>
      definition.states.flatMap(({ id, terminal }) => (terminal ? [] : [id])),
    );
    if (parsed.status !== undefined && !openStates.includes(parsed.status)) {
      return yield* new HostValidationError({
        field: "status",
        message: `Status ${parsed.status} is not an open state of a task workflow.`,
      });
    }
    const { tasks, totalCount } = yield* context.taskService.searchTasks({ ...parsed, ...scope });
    const results = tasks.map(mapTaskSummary);
    return yield* parseResponse("odt_search_tasks", RESPONSE_SCHEMAS.odt_search_tasks, {
      results,
      limit: parsed.limit,
      totalCount,
      hasMore: totalCount > results.length,
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
    const { workspaceId, repoPath, task } = yield* context.taskScopeForWorkspace(
      parsed.workspaceId ?? "",
      parsed.taskId,
    );
    const collection = yield* context.taskService.listTaskArtifacts({
      workspaceId,
      repoPath,
      taskId: task.id,
    });
    return yield* parseResponse("odt_read_task", RESPONSE_SCHEMAS.odt_read_task, {
      task: {
        ...mapPublicTask(task),
        workflowArtifacts: publicWorkflowArtifacts(task),
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
    const { workspaceId, repoPath, task } = yield* context.taskScopeForWorkspace(
      parsed.workspaceId ?? "",
      parsed.taskId,
    );
    const workflow = context.taskWorkflows.forTask(task);
    const listedArtifacts = parsed.codes.some((code) => !workflow.artifact(code))
      ? (yield* context.taskService.listTaskArtifacts({ workspaceId, repoPath, taskId: task.id }))
          .artifacts
      : [];
    const selections = [];
    for (const code of parsed.codes) {
      if (workflow.artifact(code)) {
        selections.push(workflowArtifactId(task.id, code));
        continue;
      }
      const artifact = findFreeTaskArtifact(listedArtifacts, code);
      if (artifact === undefined) return yield* missingFreeTaskArtifact(code);
      selections.push(artifact.artifactId);
    }
    const artifacts = yield* Effect.forEach(
      selections,
      (artifactId) => {
        const request: ArtifactReadRequest = {
          workspaceId,
          repoPath,
          taskId: task.id,
          artifactId,
        };
        return context.taskService.readTaskArtifact(request).pipe(
          Effect.map(({ artifact, ...content }) => ({
            ...content,
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
