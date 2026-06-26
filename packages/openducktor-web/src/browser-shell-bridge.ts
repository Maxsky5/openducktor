import type { ShellBridge } from "@openducktor/frontend";
import { Effect } from "effect";
import { getBrowserBackendUrlEffect } from "./browser-config";
import { validateExternalBrowserUrlEffect } from "./browser-url-validation";
import {
  errorMessage,
  isWebError,
  runWebBoundary,
  WebDependencyError,
  type WebError,
} from "./effect/web-errors";
import {
  buildLocalAttachmentPreviewUrl,
  createLocalHostClient,
  ensureLocalHostSessionDedupedEffect,
  subscribeLocalHostCodexAppServerEvents,
  subscribeLocalHostDevServerEvents,
  subscribeLocalHostRunEvents,
  subscribeLocalHostTaskEvents,
} from "./local-host-transport";

const openExternalUrlEffect = (url: string): Effect.Effect<void, WebError> =>
  Effect.gen(function* () {
    const validatedUrl = yield* validateExternalBrowserUrlEffect(url);
    yield* Effect.try({
      try: () => window.open(validatedUrl, "_blank", "noopener,noreferrer"),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "browser-window",
          operation: "open-external-url",
          message: errorMessage(cause),
          cause,
          details: { url: validatedUrl },
        }),
    });
  });

const resolveLocalAttachmentPreviewSrcEffect = (
  client: ReturnType<typeof createLocalHostClient>,
  path: string,
): Effect.Effect<string, WebError> =>
  Effect.gen(function* () {
    const resolvedPath = yield* Effect.tryPromise({
      try: () => client.workspaceResolveLocalAttachmentPath({ path }),
      catch: (cause) =>
        isWebError(cause)
          ? cause
          : new WebDependencyError({
              dependency: "local-web-host",
              operation: "resolve-local-attachment-path",
              message: errorMessage(cause),
              cause,
              details: { path },
            }),
    });
    yield* ensureLocalHostSessionDedupedEffect();
    return buildLocalAttachmentPreviewUrl(yield* getBrowserBackendUrlEffect(), resolvedPath.path);
  });

export const createBrowserShellBridge = (): ShellBridge => {
  const client = createLocalHostClient();

  return {
    client,
    capabilities: {
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    },
    subscribeRunEvents: subscribeLocalHostRunEvents,
    subscribeDevServerEvents: subscribeLocalHostDevServerEvents,
    subscribeTaskEvents: subscribeLocalHostTaskEvents,
    subscribeCodexAppServerEvents: subscribeLocalHostCodexAppServerEvents,
    openExternalUrl: (url) => runWebBoundary(openExternalUrlEffect(url)),
    resolveLocalAttachmentPreviewSrc: (path) =>
      runWebBoundary(resolveLocalAttachmentPreviewSrcEffect(client, path)),
  };
};
