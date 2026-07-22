import {
  type TaskAssetMediaType,
  type TaskAssetRenderContext,
  taskAssetMediaTypeSchema,
  taskAssetRenderContextSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { TaskAssetError } from "../../effect/task-asset-error";
import type { TaskAssetFilePort } from "../../ports/task-asset-file-port";
import type { TaskAssetRegistryPort } from "../../ports/task-asset-registry-port";

export type TaskAssetReadResult = {
  bytes: Uint8Array;
  mediaType: TaskAssetMediaType;
  headers: Readonly<Record<string, string>>;
};

export type TaskAssetReadService = {
  read(input: unknown): Effect.Effect<TaskAssetReadResult | null, TaskAssetError>;
};

const serveError = (
  phase: string,
  message: string,
  input: TaskAssetRenderContext,
  code: "validation" | "database" = "validation",
) =>
  new TaskAssetError({
    operation: "serve",
    code,
    taskId: input.taskId,
    assetIds: [input.assetId],
    failedPhase: phase,
    durableState: "unchanged",
    retryAllowed: false,
    message,
  });

const contentDisposition = (originalName: string): string => {
  const wellFormedName = Array.from(originalName, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return character.length === 1 && codePoint >= 0xd800 && codePoint <= 0xdfff
      ? "\uFFFD"
      : character;
  }).join("");
  const asciiName = Array.from(wellFormedName)
    .map((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      const unsafe =
        codePoint < 0x20 || codePoint > 0x7e || character === '"' || character === "\\";
      return unsafe ? "_" : character;
    })
    .join("")
    .slice(0, 255);
  const safeName = asciiName || "image";
  return `inline; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(wellFormedName)}`;
};

export const createTaskAssetReadService = (input: {
  filePort: Pick<TaskAssetFilePort, "readDurable">;
  registry: Pick<TaskAssetRegistryPort, "getAsset">;
  resolveRepoPath(workspaceId: string): Effect.Effect<string, unknown>;
}): TaskAssetReadService => ({
  read(rawInput) {
    return Effect.gen(function* () {
      const parsed = taskAssetRenderContextSchema.safeParse(rawInput);
      if (!parsed.success) {
        return yield* new TaskAssetError({
          operation: "serve",
          code: "validation",
          assetIds: [],
          failedPhase: "validate_identifiers",
          durableState: "unchanged",
          retryAllowed: false,
          message: "Task asset identifiers are invalid.",
        });
      }
      const repoPath = yield* input
        .resolveRepoPath(parsed.data.workspaceId)
        .pipe(
          Effect.mapError(() =>
            serveError("resolve_workspace", "Task asset was not found.", parsed.data),
          ),
        );
      const record = yield* input.registry
        .getAsset({
          repoPath,
          taskId: parsed.data.taskId,
          scope: parsed.data.scope,
          assetId: parsed.data.assetId,
        })
        .pipe(
          Effect.mapError(() =>
            serveError("read_registry", "Task asset could not be read.", parsed.data, "database"),
          ),
        );
      if (!record) {
        return null;
      }
      const mediaType = taskAssetMediaTypeSchema.safeParse(record.mediaType);
      if (!mediaType.success) {
        return yield* serveError(
          "validate_registered_media_type",
          "Task asset has an unsupported registered media type.",
          parsed.data,
          "database",
        );
      }
      const bytes = yield* input.filePort.readDurable(parsed.data);
      if (!bytes) {
        return null;
      }
      if (bytes.byteLength !== record.byteSize) {
        return yield* serveError(
          "validate_registered_byte_size",
          "Task asset content does not match its registry entry.",
          parsed.data,
          "database",
        );
      }
      return {
        bytes,
        mediaType: mediaType.data,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": contentDisposition(record.originalName),
          "Content-Type": mediaType.data,
          "X-Content-Type-Options": "nosniff",
        },
      };
    });
  },
});
