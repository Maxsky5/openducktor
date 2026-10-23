import {
  type McpArtifactSaveResult,
  type McpArtifactDeleteResult,
  type SetTaskArtifactInput,
  type TaskArtifact,
  type TaskMetadataArtifact,
  type WorkflowArtifactKind,
  ODT_HOST_BRIDGE_RESPONSE_SCHEMAS,
  ODT_TOOL_SCHEMAS,
  odtBrowserCallerSchema,
} from "@openducktor/contracts";
import { AGENT_ROLE_WORKFLOW_CODES } from "@openducktor/core";
import { Effect } from "effect";
import { type JSONType, z } from "zod";
import { HostValidationError } from "../../effect/host-errors";
import type { RuntimeSessionOwner } from "../../ports/workspace-session-store-port";
import { decodeArtifactInput } from "../tasks/support/artifact-content";
import type { TaskService } from "../tasks/task-service";
import {
  findFreeTaskArtifact,
  isWorkflowArtifactCode,
  missingFreeTaskArtifact,
  parseResponse,
  parseToolInput,
  toMcpTaskArtifact,
} from "./odt-mcp-bridge-model";
import type { OdtMcpBridgeError, OdtMcpToolContext } from "./odt-mcp-bridge-tool-context";

const artifactBridgeBodySchema = z.record(z.string(), z.json());

type WorkflowWriteContext = {
  context: OdtMcpToolContext;
  input: SetTaskArtifactInput;
  repoPath: string;
  taskId: string;
  markdown: string;
};
type WorkflowArtifactWriter = (
  write: WorkflowWriteContext,
) => Effect.Effect<TaskMetadataArtifact, OdtMcpBridgeError>;

const WORKFLOW_ARTIFACT_NAMES = {
  spec: "Specification",
  plan: "Implementation Plan",
  qaReport: "QA Report",
} satisfies Record<WorkflowArtifactKind, string>;

const WORKFLOW_ARTIFACT_WRITERS = {
  spec: ({ context, repoPath, taskId, markdown }) =>
    context.taskService.setSpec({ repoPath, taskId, markdown }),
  plan: ({ context, repoPath, taskId, markdown }) =>
    context.taskService
      .setPlan({
        repoPath,
        taskId,
        markdown,
        subtasks: [],
        hasExplicitSubtasks: false,
      })
      .pipe(Effect.map((result) => result.artifact)),
  qaReport: ({ context, input, repoPath, taskId, markdown }) => {
    const request = { repoPath, taskId, markdown };
    if (input.verdict === "approved")
      return context.taskService.qaApproved(request).pipe(Effect.map((result) => result.artifact));
    if (input.verdict === "rejected")
      return context.taskService.qaRejected(request).pipe(Effect.map((result) => result.artifact));
    return Effect.fail(
      new HostValidationError({
        field: "verdict",
        message: "A QA report requires an approved or rejected verdict.",
      }),
    );
  },
} satisfies Record<WorkflowArtifactKind, WorkflowArtifactWriter>;

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
    if (owner?.kind === "task" && isWorkflowArtifactCode(input.code)) {
      const permissions: Readonly<Record<string, readonly WorkflowArtifactKind[]>> =
        AGENT_ROLE_WORKFLOW_CODES;
      if (!permissions[owner.role]?.includes(input.code)) {
        return yield* new HostValidationError({
          field: "code",
          message: `The ${owner.role} role cannot write the ${input.code} workflow artifact.`,
        });
      }
    }
    if (isWorkflowArtifactCode(input.code)) {
      const markdown = yield* workflowMarkdown(input);
      const saved = yield* WORKFLOW_ARTIFACT_WRITERS[input.code]({
        context,
        input,
        repoPath,
        taskId: task.id,
        markdown,
      });
      return yield* parseResponse(
        "odt_set_task_artifact",
        ODT_HOST_BRIDGE_RESPONSE_SCHEMAS.odt_set_task_artifact,
        {
          artifact: {
            taskId: task.id,
            code: input.code,
            name: WORKFLOW_ARTIFACT_NAMES[input.code],
            classification: "workflow",
            mediaType: "text/markdown",
            revision: saved.revision,
            updatedAt: saved.updatedAt,
            verdict: input.verdict,
          },
        },
      );
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
