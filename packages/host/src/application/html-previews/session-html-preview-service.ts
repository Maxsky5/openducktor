import {
  ODT_HTML_PREVIEW_MAX_STORED_BYTES,
  odtHtmlPreviewByteSize,
  type OdtCaller,
  type OdtPublishHtmlInput,
  type OdtPublishHtmlResult,
  type SessionHtmlPreviewReadRequest,
  type SessionHtmlPreviewReadResult,
} from "@openducktor/contracts";
import { Effect } from "effect";
import { HostValidationError, type HostError } from "../../effect/host-errors";
import type { HtmlPreviewFilePort } from "../../ports/html-preview-file-port";
import type {
  SessionHtmlPreviewStorePort,
  SessionHtmlPreviewStoreReadError,
  SessionHtmlPreviewStoreWriteError,
} from "../../ports/session-html-preview-store-port";
import type { SettingsConfigPort } from "../../ports/settings-config-port";
import type { TaskStoreError } from "../../ports/task-repository-ports";
import type {
  ManagedCallerResolver,
  ManagedCallerResolverError,
} from "../agent-sessions/managed-caller-resolver";
import type {
  WorkspaceSettingsError,
  WorkspaceSettingsService,
} from "../workspaces/workspace-settings-service";
import { inlineLocalHtmlPreviewImages } from "./html-preview-image-inliner";
import { findHtmlPreviewViewportHeight } from "./html-preview-validation";

type SessionHtmlPreviewPublishError =
  | HostError
  | HostValidationError
  | ManagedCallerResolverError
  | SessionHtmlPreviewStoreWriteError
  | TaskStoreError
  | WorkspaceSettingsError;

type SessionHtmlPreviewReadError = SessionHtmlPreviewStoreReadError | WorkspaceSettingsError;

type SessionHtmlPreviewSource =
  | { readonly kind: "html"; readonly html: string }
  | { readonly kind: "path"; readonly path: string };

export type SessionHtmlPreviewService = {
  publish(input: {
    workspaceId: string;
    caller: OdtCaller;
    title: OdtPublishHtmlInput["title"];
    source: SessionHtmlPreviewSource;
  }): Effect.Effect<OdtPublishHtmlResult, SessionHtmlPreviewPublishError>;
  read(
    input: SessionHtmlPreviewReadRequest,
  ): Effect.Effect<SessionHtmlPreviewReadResult, SessionHtmlPreviewReadError>;
};

export type CreateSessionHtmlPreviewServiceInput = {
  store: SessionHtmlPreviewStorePort;
  filePort: HtmlPreviewFilePort;
  managedCallers: ManagedCallerResolver;
  workspaceSettingsService: Pick<WorkspaceSettingsService, "getRepoConfig">;
  settingsConfig: Pick<SettingsConfigPort, "resolveConfiguredPath" | "defaultWorktreeBasePath">;
  tempDir: string;
  createPreviewId?: () => string;
};

export const createSessionHtmlPreviewService = ({
  store,
  filePort,
  managedCallers,
  workspaceSettingsService,
  settingsConfig,
  tempDir,
  createPreviewId = () => crypto.randomUUID(),
}: CreateSessionHtmlPreviewServiceInput): SessionHtmlPreviewService => ({
  publish: ({ workspaceId, caller, title, source }) =>
    Effect.gen(function* () {
      const repoConfig = yield* workspaceSettingsService.getRepoConfig(workspaceId);
      yield* managedCallers.resolve({ workspaceId, caller });
      const worktreeBase = repoConfig.worktreeBasePath
        ? settingsConfig.resolveConfiguredPath(repoConfig.worktreeBasePath)
        : settingsConfig.defaultWorktreeBasePath(repoConfig.workspaceId);
      const allowedRoots = [repoConfig.repoPath, worktreeBase, tempDir];
      const rawHtml =
        source.kind === "path"
          ? yield* filePort.readHtmlFile(source.path, allowedRoots)
          : source.html;

      const viewportHeight = findHtmlPreviewViewportHeight(rawHtml);
      if (viewportHeight !== undefined) {
        return yield* new HostValidationError({
          field: "html",
          message: `html must not use the viewport height unit or class '${viewportHeight}'. The preview frame grows to fit the page, so a viewport height would make it grow again and again. Let content set the height, or use fixed pixel heights.`,
        });
      }

      const inlinedHtml = yield* inlineLocalHtmlPreviewImages(rawHtml, allowedRoots, filePort);
      const byteSize = odtHtmlPreviewByteSize(inlinedHtml);
      if (byteSize <= 0 || byteSize > ODT_HTML_PREVIEW_MAX_STORED_BYTES) {
        return yield* new HostValidationError({
          field: "html",
          message: `html must be between 1 and ${ODT_HTML_PREVIEW_MAX_STORED_BYTES} bytes of UTF-8.`,
        });
      }

      const previewId = createPreviewId();
      const saved = yield* store.save({
        workspaceId: repoConfig.workspaceId,
        previewId,
        html: inlinedHtml,
        byteSize,
      });

      return {
        htmlPreview: {
          previewId: saved.previewId,
          title,
          byteSize: saved.byteSize,
        },
      };
    }),

  read: ({ workspaceId, previewId }) => store.read({ workspaceId, previewId }),
});
