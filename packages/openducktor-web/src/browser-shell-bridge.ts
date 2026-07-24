import { createDisabledAppUpdateBridge, type ShellBridge } from "@openducktor/frontend";
import { getAppVersion } from "@openducktor/frontend/lib/app-version";
import { Effect } from "effect";
import { getBrowserBackendUrlEffect } from "./browser-config";
import { validateExternalBrowserUrlEffect } from "./browser-url-validation";
import {
  errorMessage,
  isWebError,
  runWebBoundary,
  WebDependencyError,
  type WebError,
  WebValidationError,
} from "./effect/web-errors";
import {
  buildLocalAttachmentPreviewUrl,
  createLocalHostClient,
  ensureLocalHostSessionDedupedEffect,
  observeLocalHostAgentSessions,
  subscribeLocalHostDevServerEvents,
  subscribeLocalHostRunEvents,
  subscribeLocalHostTaskStream,
} from "./local-host-transport";
import { createBrowserTerminalBridge } from "./terminals/browser-terminal-transport";

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
  const currentVersion = getAppVersion();
  if (!currentVersion) {
    throw new WebValidationError({
      message: "OpenDucktor web build version is missing.",
      field: "VITE_ODT_APP_VERSION",
    });
  }
  const client = createLocalHostClient();

  return {
    client,
    appUpdates: createDisabledAppUpdateBridge({
      status: "disabled",
      currentVersion,
      disabledCode: "unsupported_web_runner",
      disabledReason: "The browser runner does not install updates in OpenDucktor.",
    }),
    capabilities: {
      canOpenExternalUrls: true,
      canPreviewLocalAttachments: true,
    },
    subscribeRunEvents: subscribeLocalHostRunEvents,
    subscribeDevServerEvents: subscribeLocalHostDevServerEvents,
    observeAgentSessionLive: observeLocalHostAgentSessions,
    subscribeTaskStream: subscribeLocalHostTaskStream,
    openExternalUrl: (url) => runWebBoundary(openExternalUrlEffect(url)),
    resolveLocalAttachmentPreviewSrc: (path) =>
      runWebBoundary(resolveLocalAttachmentPreviewSrcEffect(client, path)),
    terminals: createBrowserTerminalBridge(),
  };
};
