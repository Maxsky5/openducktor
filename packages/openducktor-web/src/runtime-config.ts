import { Effect } from "effect";
import { type BrowserRuntimeConfig, configureBrowserRuntimeConfig } from "./browser-config";
import {
  errorMessage,
  runWebBoundary,
  WebDependencyError,
  WebValidationError,
} from "./effect/web-errors";

export const RUNTIME_CONFIG_PATH = "/openducktor-config.json";

const isRuntimeConfigRecord = (value: unknown): value is BrowserRuntimeConfig => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const config = value as { backendUrl?: unknown; appToken?: unknown };
  return typeof config.backendUrl === "string" && typeof config.appToken === "string";
};

export const loadBrowserRuntimeConfigEffect = (
  fetchImpl: typeof fetch = fetch,
): Effect.Effect<void, WebDependencyError | WebValidationError> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetchImpl(RUNTIME_CONFIG_PATH, { cache: "no-store" }),
      catch: (cause) =>
        new WebDependencyError({
          dependency: "browser-runtime-config",
          operation: "fetch",
          message: errorMessage(cause),
          cause,
          details: { path: RUNTIME_CONFIG_PATH },
        }),
    });
    if (!response.ok) {
      return yield* new WebDependencyError({
        dependency: "browser-runtime-config",
        operation: "fetch",
        message: `OpenDucktor web failed to load runtime config from ${RUNTIME_CONFIG_PATH}: HTTP ${response.status}.`,
        details: { path: RUNTIME_CONFIG_PATH, status: response.status },
      });
    }

    const config = yield* Effect.tryPromise({
      try: () => response.json() as Promise<unknown>,
      catch: (cause) =>
        new WebValidationError({
          message: `OpenDucktor web runtime config from ${RUNTIME_CONFIG_PATH} is not valid JSON.`,
          cause,
          details: { path: RUNTIME_CONFIG_PATH },
        }),
    });
    if (!isRuntimeConfigRecord(config)) {
      return yield* new WebValidationError({
        message: `OpenDucktor web runtime config from ${RUNTIME_CONFIG_PATH} is missing backendUrl or appToken.`,
        details: { path: RUNTIME_CONFIG_PATH },
      });
    }

    configureBrowserRuntimeConfig(config);
  });

export const loadBrowserRuntimeConfig = (fetchImpl: typeof fetch = fetch): Promise<void> =>
  runWebBoundary(loadBrowserRuntimeConfigEffect(fetchImpl));
