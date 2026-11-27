import { randomUUID } from "node:crypto";
import { mkdir, rename, rm, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ODT_HTML_PREVIEW_MAX_STORED_BYTES,
  sessionHtmlPreviewIdSchema,
  workspaceIdSchema,
} from "@openducktor/contracts";
import { Effect } from "effect";
import {
  HostOperationError,
  HostResourceError,
  HostValidationError,
} from "../../effect/host-errors";
import type {
  SessionHtmlPreviewStorePort,
  SessionHtmlPreviewStoreReadError,
  SessionHtmlPreviewStoreWriteError,
} from "../../ports/session-html-preview-store-port";
import { isPathWithinRoot, readRegularFileNoFollow } from "./html-preview-fs";

const SESSION_HTML_PREVIEWS_DIR = "session-html-previews";

const resolveWorkspaceDir = (
  previewsRoot: string,
  workspaceId: string,
): Effect.Effect<string, HostValidationError> => {
  if (!workspaceIdSchema.safeParse(workspaceId).success) {
    return Effect.fail(
      new HostValidationError({
        field: "workspaceId",
        message: "Invalid workspaceId for HTML preview storage.",
      }),
    );
  }
  const workspaceDir = path.resolve(previewsRoot, workspaceId);
  if (!isPathWithinRoot(workspaceDir, previewsRoot)) {
    return Effect.fail(
      new HostValidationError({
        field: "workspaceId",
        message: "HTML preview workspace path escapes the storage directory.",
      }),
    );
  }
  return Effect.succeed(workspaceDir);
};

const resolvePreviewFilePath = (
  previewsRoot: string,
  workspaceId: string,
  previewId: string,
): Effect.Effect<{ workspaceDir: string; filePath: string }, HostValidationError> =>
  Effect.gen(function* () {
    const workspaceDir = yield* resolveWorkspaceDir(previewsRoot, workspaceId);
    if (!sessionHtmlPreviewIdSchema.safeParse(previewId).success) {
      return yield* new HostValidationError({
        field: "previewId",
        message: "Invalid previewId for HTML preview storage.",
      });
    }
    const filePath = path.resolve(workspaceDir, `${previewId}.html`);
    if (!isPathWithinRoot(filePath, workspaceDir)) {
      return yield* new HostValidationError({
        field: "previewId",
        message: "HTML preview file path escapes the workspace storage directory.",
      });
    }
    return { workspaceDir, filePath };
  });

/**
 * Stores each published session HTML preview as an atomic UTF-8 `.html` file under
 * `<configDir>/session-html-previews/<workspaceId>/<previewId>.html`, keeping large HTML and
 * inlined image payloads out of the SQLite database.
 */
export const createNodeSessionHtmlPreviewStore = ({
  configDir,
}: {
  configDir: string;
}): SessionHtmlPreviewStorePort => {
  const previewsRoot = path.resolve(configDir, SESSION_HTML_PREVIEWS_DIR);

  return {
    save: (
      input,
    ): Effect.Effect<
      { previewId: string; html: string; byteSize: number },
      SessionHtmlPreviewStoreWriteError
    > =>
      Effect.gen(function* () {
        const { workspaceDir, filePath } = yield* resolvePreviewFilePath(
          previewsRoot,
          input.workspaceId,
          input.previewId,
        );
        const tempPath = path.join(workspaceDir, `.tmp-${randomUUID()}.html`);
        yield* Effect.tryPromise({
          try: async () => {
            await mkdir(workspaceDir, { recursive: true, mode: 0o700 });
            try {
              await writeFile(tempPath, input.html, { encoding: "utf8", mode: 0o600 });
              await rename(tempPath, filePath);
            } catch (cause) {
              await unlink(tempPath).catch(() => {});
              throw cause;
            }
          },
          catch: (cause) =>
            new HostOperationError({
              operation: "sessionHtmlPreviewStore.save",
              message: `Failed to store HTML preview '${input.previewId}': ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            }),
        });
        return {
          previewId: input.previewId,
          html: input.html,
          byteSize: input.byteSize,
        };
      }),

    read: (
      input,
    ): Effect.Effect<
      { previewId: string; html: string; byteSize: number },
      SessionHtmlPreviewStoreReadError
    > =>
      Effect.gen(function* () {
        const { filePath } = yield* resolvePreviewFilePath(
          previewsRoot,
          input.workspaceId,
          input.previewId,
        );
        const opened = yield* readRegularFileNoFollow(filePath, {
          maxBytes: ODT_HTML_PREVIEW_MAX_STORED_BYTES,
          requireSingleLink: false,
        });
        if (opened.kind === "missing") {
          return yield* new HostResourceError({
            resource: input.previewId,
            operation: "sessionHtmlPreview.read",
            message: `HTML preview '${input.previewId}' is not available in this workspace.`,
          });
        }
        if (opened.kind !== "ok" || opened.size <= 0) {
          const message = `Failed to read HTML preview '${input.previewId}': stored HTML preview file is unreadable or exceeds size limits.`;
          if (opened.kind === "unreadable" && opened.cause !== undefined) {
            return yield* new HostOperationError({
              operation: "sessionHtmlPreviewStore.read",
              message,
              cause: opened.cause,
            });
          }
          return yield* new HostOperationError({
            operation: "sessionHtmlPreviewStore.read",
            message,
          });
        }
        return {
          previewId: input.previewId,
          html: opened.bytes.toString("utf8"),
          byteSize: opened.bytes.byteLength,
        };
      }),

    removeWorkspace: (workspaceId) =>
      Effect.gen(function* () {
        const workspaceDir = yield* resolveWorkspaceDir(previewsRoot, workspaceId);
        yield* Effect.tryPromise({
          try: () => rm(workspaceDir, { recursive: true, force: true }),
          catch: (cause) =>
            new HostOperationError({
              operation: "sessionHtmlPreviewStore.removeWorkspace",
              message: `Failed to remove HTML previews for workspace '${workspaceId}': ${cause instanceof Error ? cause.message : String(cause)}`,
              cause,
            }),
        });
      }),
  };
};
