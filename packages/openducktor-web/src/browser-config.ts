import { Effect } from "effect";
import { runWebSyncBoundary, WebValidationError } from "./effect/web-errors";

type BrowserEnv = Record<string, string | undefined> | undefined;
export type BrowserRuntimeConfig = {
  backendUrl?: string;
  appToken?: string;
};

let browserRuntimeConfig: BrowserRuntimeConfig | undefined;

export const configureBrowserRuntimeConfig = (config: BrowserRuntimeConfig): void => {
  browserRuntimeConfig = config;
};

const readBrowserEnv = (): BrowserEnv =>
  (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ??
  (typeof process !== "undefined" ? process.env : undefined);

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

const readBrowserLocationOrigin = (): string | undefined => {
  if (typeof window === "undefined") {
    return undefined;
  }

  const origin = window.location.origin;
  return origin === "null" ? undefined : origin;
};

const readBrowserRuntimeConfig = (): BrowserRuntimeConfig | undefined => {
  return browserRuntimeConfig;
};

const requireBrowserEnvValueEffect = (
  env: BrowserEnv,
  key: string,
  description: string,
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    const value = env?.[key]?.trim();
    if (!value) {
      return yield* new WebValidationError({
        field: key,
        message: `OpenDucktor web is missing ${description}. Start the app through @openducktor/web so the launcher can inject ${key}.`,
      });
    }

    return value;
  });

const parseLoopbackHttpOriginEffect = (rawUrl: string): Effect.Effect<URL, WebValidationError> =>
  Effect.gen(function* () {
    const parsed = yield* Effect.try({
      try: () => new URL(rawUrl),
      catch: (cause) =>
        new WebValidationError({
          message:
            "OpenDucktor web backend URL is invalid. Start the app through @openducktor/web.",
          cause,
          details: { rawUrl },
        }),
    });

    if (parsed.protocol !== "http:") {
      return yield* new WebValidationError({
        message: "OpenDucktor web backend URL must use http on a loopback interface.",
        details: { rawUrl },
      });
    }
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
      return yield* new WebValidationError({
        message: "OpenDucktor web backend URL must target 127.0.0.1, localhost, or [::1].",
        details: { rawUrl },
      });
    }
    if (!parsed.port) {
      return yield* new WebValidationError({
        message: "OpenDucktor web backend URL must include an explicit port.",
        details: { rawUrl },
      });
    }
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return yield* new WebValidationError({
        message:
          "OpenDucktor web backend URL must be an origin only, without credentials, path, query, or fragment.",
        details: { rawUrl },
      });
    }

    return parsed;
  });

const hostForOrigin = (hostname: string): string => {
  if (hostname === "::1" || hostname === "[::1]") {
    return "[::1]";
  }

  return hostname;
};

const alignBackendOriginWithBrowserOriginEffect = (
  backendOrigin: URL,
  browserOrigin?: string,
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    if (!browserOrigin || browserOrigin === "null") {
      return backendOrigin.origin;
    }

    const frontendOrigin = yield* Effect.try({
      try: () => new URL(browserOrigin),
      catch: (cause) =>
        new WebValidationError({
          message: "OpenDucktor web browser origin is invalid.",
          cause,
          details: { browserOrigin },
        }),
    });

    if (frontendOrigin.protocol !== "http:" || !LOOPBACK_HOSTS.has(frontendOrigin.hostname)) {
      return backendOrigin.origin;
    }

    return new URL(
      `${frontendOrigin.protocol}//${hostForOrigin(frontendOrigin.hostname)}:${backendOrigin.port}`,
    ).origin;
  });

const normalizeLoopbackHttpUrlEffect = (
  rawUrl: string,
  browserOrigin?: string,
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    const parsed = yield* parseLoopbackHttpOriginEffect(rawUrl);

    return yield* alignBackendOriginWithBrowserOriginEffect(parsed, browserOrigin);
  });

export const getBrowserBackendUrlEffect = (
  env: BrowserEnv = readBrowserEnv(),
  browserOrigin: string | undefined = readBrowserLocationOrigin(),
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    const configuredUrl = readBrowserRuntimeConfig()?.backendUrl?.trim();
    const rawUrl = configuredUrl
      ? configuredUrl
      : yield* requireBrowserEnvValueEffect(
          env,
          "VITE_ODT_BROWSER_BACKEND_URL",
          "the local web host URL",
        );
    return yield* normalizeLoopbackHttpUrlEffect(rawUrl, browserOrigin);
  });

export const getBrowserBackendUrl = (
  env: BrowserEnv = readBrowserEnv(),
  browserOrigin: string | undefined = readBrowserLocationOrigin(),
): string => runWebSyncBoundary(getBrowserBackendUrlEffect(env, browserOrigin));

export const getBrowserAuthTokenEffect = (
  env: BrowserEnv = readBrowserEnv(),
): Effect.Effect<string, WebValidationError> =>
  Effect.gen(function* () {
    const configuredToken = readBrowserRuntimeConfig()?.appToken?.trim();
    if (configuredToken) {
      return configuredToken;
    }
    return yield* requireBrowserEnvValueEffect(
      env,
      "VITE_ODT_BROWSER_AUTH_TOKEN",
      "the local web host app token",
    );
  });

export const getBrowserAuthToken = (env: BrowserEnv = readBrowserEnv()): string =>
  runWebSyncBoundary(getBrowserAuthTokenEffect(env));
