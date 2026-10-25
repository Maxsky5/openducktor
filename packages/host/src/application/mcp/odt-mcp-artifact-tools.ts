import {
  type McpArtifactSaveResult,
  type McpArtifactDeleteResult,
  type SetTaskArtifactInput,
  type TaskArtifact,
  freeArtifactCodeSchema,
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
  odtBrowserCallerSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { type JSONType, z } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import type { RuntimeSessionOwner } from "../../ports/workspace-session-store-port";
import { decodeArtifactInput } from "../tasks/support/artifact-content";
import type { TaskService } from "../tasks/task-service";
import {
  findFreeTaskArtifact,
  missingFreeTaskArtifact,
  parseResponse,
  parseToolInput,
  toMcpTaskArtifact,
} from "./odt-mcp-bridge-model";
import type { OdtMcpBridgeError, OdtMcpToolContext } from "./odt-mcp-bridge-tool-context";

const artifactBridgeBodySchema = z.record(z.string(), z.json());

export const executeSetTaskArtifact = (
  context: OdtMcpToolContext,
  body: JSONType,
): Effect.Effect<McpArtifactSaveResult, OdtMcpBridgeError> =>
  Effect.gen(function* () {
    const { caller: rawCaller, ...toolBody } = yield* parseToolInput(
      "odt_set_task_artifact",
      artifactBridgeBodySchema,
      body,
    );
    const input = yield* parseToolInput(
      "odt_set_task_artifact",
      ODT_TOOL_SCHEMAS.odt_set_task_artifact,
      toolBody,
    );
    const workspaceId = input.workspaceId ?? "";
    const { repoPath, task } = yield* context.taskScopeForWorkspace(workspaceId, input.taskId);
    const owner = yield* resolveArtifactWriter(
      context,
      "odt_set_task_artifact",
      rawCaller,
      workspaceId,
      task.id,
    );
    const workflow = context.taskWorkflows.forRepo(repoPath);
    const declared = workflow.artifact(input.code);
    if (declared) {
      yield* rejectFreeArtifactFields(input);
      const markdown = yield* workflowMarkdown(input);
      const saveInput: Parameters<OdtMcpToolContext["taskService"]["workflowArtifactSave"]>[0] = {
        repoPath,
        taskId: task.id,
        code: input.code,
        markdown,
        submit: true,
        sourceTool: "odt_set_task_artifact",
        updatedBy: owner?.kind === "task" ? owner.role : "user",
      };
      if (input.verdict !== undefined) saveInput.verdict = input.verdict;
      const saved = yield* context.taskService.workflowArtifactSave(saveInput);
      const artifact = {
        taskId: task.id,
        code: input.code,
        name: declared.label,
        classification: "workflow",
        mediaType: "text/markdown",
        revision: saved.artifact.revision,
        updatedAt: saved.artifact.updatedAt,
      };
      return yield* parseResponse(
        "odt_set_task_artifact",
        ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_set_task_artifact,
        {
          artifact:
            input.verdict === undefined ? artifact : { ...artifact, verdict: input.verdict },
        },
      );
    }
    if (input.verdict !== undefined) {
      return yield* new HostValidationError({
        field: "verdict",
        message: "verdict applies only to a review artifact of the workflow.",
      });
    }
    const freeCode = freeArtifactCodeSchema.safeParse(input.code);
    if (!freeCode.success) {
      return yield* new HostValidationError({
        field: "code",
        message:
          `${input.code} is not a workflow artifact code. ${freeCode.error.issues[0]?.message ?? ""}`.trim(),
      });
    }
    const artifact = toMcpTaskArtifact(yield* writeFreeArtifact(context, input, repoPath, task.id));
    return yield* parseResponse(
      "odt_set_task_artifact",
      ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_set_task_artifact,
      {
        artifact,
      },
    );
  });

const writeFreeArtifact = (
  context: OdtMcpToolContext,
  input: SetTaskArtifactInput,
  repoPath: string,
  taskId: string,
): Effect.Effect<TaskArtifact, OdtMcpBridgeError> =>
  Effect.gen(function* () {
    const { code, name, fileName, mediaType } = input;
    const dataBase64 = artifactContentBase64(input);
    const collection = yield* context.taskService.listTaskArtifacts({ repoPath, taskId });
    const existing = findFreeTaskArtifact(collection.artifacts, code);
    if (existing === undefined) {
      if (
        name === undefined ||
        fileName === undefined ||
        mediaType === undefined ||
        dataBase64 === undefined
      ) {
        return yield* new HostValidationError({
          field: "code",
          message:
            "To create an artifact, supply code, name, fileName, mediaType, and content or dataBase64. To update one, use its existing code.",
        });
      }
      const result = yield* context.taskService.createTaskArtifact({
        repoPath,
        taskId,
        code,
        name,
        fileName,
        mediaType,
        dataBase64,
      });
      return result.artifact;
    }
    if (dataBase64 === undefined) {
      if (
        name === undefined ||
        name === existing.name ||
        fileName !== undefined ||
        mediaType !== undefined
      ) {
        return yield* new HostValidationError({
          field: "content",
          message:
            "To rename an artifact, supply a different name without fileName or mediaType. To replace content, supply fileName, mediaType, and content or dataBase64.",
        });
      }
      const result = yield* context.taskService.renameTaskArtifact({
        repoPath,
        taskId,
        artifactId: existing.artifactId,
        name,
      });
      return result.artifact;
    }
    if (fileName === undefined || mediaType === undefined) {
      return yield* new HostValidationError({
        field: "content",
        message:
          "To replace artifact content, supply fileName and mediaType with content or dataBase64. Supply name to rename it in the same write.",
      });
    }
    const request: Parameters<TaskService["replaceTaskArtifact"]>[0] = {
      repoPath,
      taskId,
      artifactId: existing.artifactId,
      fileName,
      mediaType,
      dataBase64,
    };
    if (name !== undefined) request.name = name;
    const result = yield* context.taskService.replaceTaskArtifact(request);
    return result.artifact;
  });

export const executeDeleteTaskArtifact = (
  context: OdtMcpToolContext,
  body: JSONType,
): Effect.Effect<McpArtifactDeleteResult, OdtMcpBridgeError> =>
  Effect.gen(function* () {
    const { caller: rawCaller, ...toolBody } = yield* parseToolInput(
      "odt_delete_task_artifact",
      artifactBridgeBodySchema,
      body,
    );
    const parsed = yield* parseToolInput(
      "odt_delete_task_artifact",
      ODT_TOOL_SCHEMAS.odt_delete_task_artifact,
      toolBody,
    );
    const workspaceRepoPath = yield* context.repoPathForWorkspace(parsed.workspaceId ?? "");
    if (context.taskWorkflows.forRepo(workspaceRepoPath).artifact(parsed.code)) {
      return yield* new HostValidationError({
        field: "code",
        message: `${parsed.code} is a workflow artifact. Only free artifacts can be deleted.`,
      });
    }
    const { repoPath, task } = yield* context.taskScopeForWorkspace(
      parsed.workspaceId ?? "",
      parsed.taskId,
    );
    yield* resolveArtifactWriter(
      context,
      "odt_delete_task_artifact",
      rawCaller,
      parsed.workspaceId ?? "",
      task.id,
    );
    const collection = yield* context.taskService.listTaskArtifacts({ repoPath, taskId: task.id });
    const artifact = findFreeTaskArtifact(collection.artifacts, parsed.code);
    if (artifact === undefined) return yield* missingFreeTaskArtifact(parsed.code);
    const { artifactId: _artifactId, ...result } = yield* context.taskService.deleteTaskArtifact({
      repoPath,
      taskId: task.id,
      artifactId: artifact.artifactId,
    });
    return yield* parseResponse(
      "odt_delete_task_artifact",
      ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_delete_task_artifact,
      { ...result, code: parsed.code },
    );
  });

const resolveArtifactWriter = (
  context: OdtMcpToolContext,
  toolName: "odt_set_task_artifact" | "odt_delete_task_artifact",
  rawCaller: JSONType | undefined,
  workspaceId: string,
  taskId: string,
): Effect.Effect<RuntimeSessionOwner | undefined, OdtMcpBridgeError> =>
  Effect.gen(function* () {
    if (rawCaller === undefined) return undefined;
    const caller = yield* parseToolInput(toolName, odtBrowserCallerSchema, rawCaller);
    const owner = yield* context.managedCallers.resolve({ workspaceId, caller });
    if (owner.kind === "task" && owner.taskId !== taskId) {
      return yield* new HostValidationError({
        field: "taskId",
        message: "Managed task sessions can write artifacts only for their own task.",
      });
    }
    return owner;
  });

/** Workflow artifacts take their name, file name, and media type from the workflow. */
const rejectFreeArtifactFields = (
  input: SetTaskArtifactInput,
): Effect.Effect<void, HostValidationError> => {
  for (const field of ["name", "fileName", "mediaType"] as const) {
    if (input[field] !== undefined) {
      return Effect.fail(
        new HostValidationError({ field, message: `${field} applies only to free artifacts.` }),
      );
    }
  }
  return Effect.void;
};

const artifactContentBase64 = (
  input: Pick<SetTaskArtifactInput, "content" | "dataBase64">,
): string | undefined =>
  input.dataBase64 !== undefined
    ? input.dataBase64
    : input.content !== undefined
      ? Buffer.from(input.content, "utf8").toString("base64")
      : undefined;

const workflowMarkdown = (
  input: Pick<SetTaskArtifactInput, "content" | "dataBase64">,
): Effect.Effect<string, HostValidationError> =>
  Effect.try({
    try: () => {
      let markdown: string;
      if (input.content !== undefined) {
        markdown = input.content;
      } else if (input.dataBase64 !== undefined) {
        markdown = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          decodeArtifactInput(input.dataBase64),
        );
      } else {
        throw new HostValidationError({
          field: "content",
          message: "A workflow artifact requires Markdown content.",
        });
      }
      if (!markdown.trim()) {
        throw new HostValidationError({
          field: "content",
          message: "Workflow Markdown must not be empty.",
        });
      }
      return markdown;
    },
    catch: (cause) =>
      new HostValidationError({
        field: "content",
        message:
          cause instanceof HostValidationError
            ? cause.message
            : "Workflow artifact content must contain valid UTF-8 Markdown.",
        cause,
      }),
  });
